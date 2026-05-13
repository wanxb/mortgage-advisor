import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import {
  BarChart2,
  Banknote,
  CalendarDays,
  Calculator,
  Landmark,
  LineChart,
  PiggyBank,
  Scale,
  Trash2,
  WalletCards,
} from 'lucide-react';
import {
  calculateBudgetReverse,
  buildRateSegmentSummary,
  calculateHistoricalLoanPlan,
  calculateMortgagePlan,
  calculatePrepaymentComparison,
  calculateRateAdjustedPlan,
  formatMoney,
} from './core/mortgageCalculator';
import type { HistoricalLoanEvent, LoanInput, LoanPart, LoanPlan, LoanType, PrepaymentMode, RateSegmentSummary, RepaymentMethod } from './types/mortgage';
import { formatDate, getNextMonthFirstDay } from './utils/date';
import { wanToYuan } from './utils/money';
import { loadStoredValue, removeStoredValue, saveStoredValue } from './utils/persistence';
import type { PaymentScheduleItem } from './types/mortgage';
import { InfoHint, Slider, Tooltip } from './components/ui';

type ScenarioKey = 'planning' | 'active';
type TabKey = 'schedule' | 'history' | 'prepay' | 'rate' | 'compare' | 'budget';

interface LoanFormState {
  loanType: LoanType;
  repaymentMethod: RepaymentMethod;
  amountWan: number;
  years: number;
  annualRate: number;
  firstPaymentDate: string;
  commercialAmountWan: number;
  commercialYears: number;
  commercialRate: number;
  fundAmountWan: number;
  fundYears: number;
  fundRate: number;
}

const activeLoanTabs: Array<{ key: TabKey; label: string }> = [
  { key: 'schedule', label: '还款计划' },
  { key: 'prepay', label: '提前还款' },
  { key: 'rate', label: '利率调整' },
  { key: 'compare', label: '方案对比' },
];

const planningTabs: Array<{ key: TabKey; label: string }> = [
  { key: 'schedule', label: '还款计划' },
  { key: 'budget', label: '预算反推' },
];

const RATE_MIN = 0;
const RATE_MAX = 8;
const RATE_STEP = 0.005;
const YEAR_MIN = 1;
const YEAR_MAX = 30;
const STORAGE_PREFIX = 'mortgage-advisor:v1';

const repaymentExplanation: Record<RepaymentMethod, string> = {
  equalPayment: '每月月供金额固定。\n前期利息占比高、本金占比低，整体压力稳定。',
  equalPrincipal: '每月偿还固定本金，月供逐月递减。\n总利息更少，但前期压力更大。',
};

const defaultForm: LoanFormState = {
  loanType: 'commercial',
  repaymentMethod: 'equalPayment',
  amountWan: 100,
  years: 30,
  annualRate: 3.5,
  firstPaymentDate: getNextMonthFirstDay(),
  commercialAmountWan: 70,
  commercialYears: 30,
  commercialRate: 3.7,
  fundAmountWan: 30,
  fundYears: 30,
  fundRate: 2.85,
};

const defaultPrepayInput = {
  date: defaultForm.firstPaymentDate,
  amountWan: 10,
  target: 'commercial' as LoanPart,
  includeCurrentMonthPayment: true,
  penaltyFee: 0,
};

const defaultRateInput = {
  effectiveDate: defaultForm.firstPaymentDate,
  newAnnualRate: 3,
  newCommercialRate: defaultForm.commercialRate,
  newFundRate: defaultForm.fundRate,
};

const defaultBudgetInput = {
  affordableMonthlyPayment: 4000,
  years: 30,
  annualRate: 3.5,
  downPaymentRatio: 30,
};

const defaultHistoryEvents: HistoricalLoanEvent[] = [];

function toLoanInput(
  form: LoanFormState,
  overrides: Partial<Pick<LoanInput, 'amount' | 'years' | 'annualRate' | 'firstPaymentDate'>> = {},
): LoanInput {
  return {
    loanType: form.loanType,
    repaymentMethod: form.repaymentMethod,
    amount: overrides.amount ?? wanToYuan(form.amountWan),
    years: overrides.years ?? form.years,
    annualRate: overrides.annualRate ?? form.annualRate,
    firstPaymentDate: overrides.firstPaymentDate ?? form.firstPaymentDate,
    commercial: {
      amount: wanToYuan(form.commercialAmountWan),
      years: form.commercialYears,
      annualRate: form.commercialRate,
    },
    fund: {
      amount: wanToYuan(form.fundAmountWan),
      years: form.fundYears,
      annualRate: form.fundRate,
    },
  };
}

const baseInputClass =
  'h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-900/40';

const dateInputClass = `${baseInputClass} min-w-[9.5rem] pr-2 [color-scheme:light] dark:[color-scheme:dark]`;

function formatRate(rate: number | undefined): string {
  if (!Number.isFinite(rate)) return '-';
  return `${parseFloat((rate as number).toFixed(3))}%`;
}

function formatSegmentRate(segment: RateSegmentSummary): string {
  if (segment.commercialRate != null && segment.fundRate != null) {
    return `${parseFloat(segment.commercialRate.toFixed(3))}/${parseFloat(segment.fundRate.toFixed(3))}%`;
  }
  if (segment.commercialRate != null) return formatRate(segment.commercialRate);
  if (segment.fundRate != null) return formatRate(segment.fundRate);
  return formatRate(segment.annualRate);
}

function formatMoneyPlain(value: number): string {
  return Number(value || 0).toLocaleString('zh-CN', {
    maximumFractionDigits: 0,
  });
}

function openDatePicker(event: MouseEvent<HTMLInputElement>) {
  try {
    event.currentTarget.showPicker?.();
  } catch {
    event.currentTarget.focus();
  }
}

function getCurrentPaymentItem(schedule: PaymentScheduleItem[]): PaymentScheduleItem | undefined {
  const today = formatDate(new Date());
  return schedule.find((item) => item.date >= today) || schedule[schedule.length - 1];
}

const labelBase = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300';

function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={`${labelBase} flex items-center gap-1`}>
        {label}
        {hint ? <InfoHint text={hint} /> : null}
      </span>
      {children}
    </label>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  tooltip?: string;
}

function SegmentedButton<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentedOption<T>>;
}) {
  return (
    <div
      className="grid rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = value === option.value;
        const button = (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`min-h-10 w-full rounded-md px-3 text-sm font-medium transition ${
              active
                ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-950 dark:text-blue-300'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100'
            }`}
          >
            {option.label}
          </button>
        );
        return option.tooltip ? (
          <Tooltip key={option.value} text={option.tooltip} className="w-full">
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}

function StatCard({
  title,
  value,
  desc,
  icon: Icon,
  className = '',
}: {
  title: string;
  value: string;
  desc?: string;
  icon: typeof Calculator;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
          <Icon size={16} aria-hidden />
        </span>
      </div>
      <p className="money-figures mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
      {desc ? <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">{desc}</p> : null}
    </div>
  );
}

interface CompareColumn {
  title: string;
  subtitle?: string;
  error?: string;
}

interface CompareRow {
  label: string;
  values: Array<string | undefined>;
}

function formatTableValue(value: string | undefined): string {
  return value?.replace(/\s?(万元|元|期|天)/g, '') ?? '-';
}

function MultiCompareTable({ columns, rows }: { columns: CompareColumn[]; rows: CompareRow[] }) {
  return (
    <div className="advisor-scrollbar-hidden overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table
        className="advisor-data-table advisor-compare-table w-full table-fixed text-xs sm:text-sm"
        style={{ minWidth: `${Math.max(680, 112 + columns.length * 168)}px` }}
      >
        <colgroup>
          <col className="w-[112px]" />
          {columns.map((column) => (
            <col key={column.title} className="w-[168px]" />
          ))}
        </colgroup>
        <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50 px-2 py-3 text-left font-medium dark:bg-slate-800 sm:px-3">指标</th>
            {columns.map((column) => (
              <th key={column.title} className="px-2 py-3 text-right font-medium align-top sm:px-3">
                <div className="compare-heading font-semibold text-slate-700 dark:text-slate-200">{column.title}</div>
                {column.subtitle ? (
                  <div className="compare-heading mt-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">{column.subtitle}</div>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-slate-200 dark:border-slate-700">
              <td className="sticky left-0 bg-white px-2 py-3 text-slate-700 dark:bg-slate-900 dark:text-slate-300 sm:px-3">{row.label}</td>
              {row.values.map((value, index) => (
                <td key={index} className="money-figures whitespace-nowrap px-2 py-3 text-right text-slate-700 dark:text-slate-200 sm:px-3">
                  {formatTableValue(value)}
                </td>
              ))}
            </tr>
          ))}
          {columns.some((column) => column.error) ? (
            <tr className="border-t border-slate-200 dark:border-slate-700">
              <td className="sticky left-0 bg-white px-2 py-3 text-slate-500 dark:bg-slate-900 dark:text-slate-400 sm:px-3">备注</td>
              {columns.map((column, index) => (
                <td key={index} className="compare-heading px-2 py-3 text-right text-xs text-amber-700 dark:text-amber-400 sm:px-3">
                  {column.error || ''}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function describePrepay(date: string, amountWan: number): string {
  return `${date} · ${amountWan}万`;
}

function describeRate(effectiveDate: string, rate: number): string {
  return `${effectiveDate} · 调整为 ${rate}%`;
}

function formatMoneyDiff(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return '0 元';
  return `${value > 0 ? '+' : ''}${formatMoney(value)}`;
}

function formatPeriodDiff(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0 期';
  return `${value > 0 ? '+' : ''}${value} 期`;
}

function formatEndDateDiff(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '不变';
  return value < 0 ? `提前 ${Math.abs(value)} 期` : `延后 ${value} 期`;
}

function getPaymentItemRateDesc(item: PaymentScheduleItem, loanType: LoanType): string {
  if (loanType === 'combined') {
    const comm = item.commercial;
    const fund = item.fund;
    if (comm && fund) return `商 ${formatRate(comm.annualRate)} / 公 ${formatRate(fund.annualRate)}`;
    return `利率 ${formatRate(comm?.annualRate ?? fund?.annualRate)}`;
  }
  return `利率 ${formatRate(item.annualRate)}`;
}

function formatPaymentItemRate(item: PaymentScheduleItem): string {
  const commRate = item.commercial?.annualRate;
  const fundRate = item.fund?.annualRate;
  if (commRate != null && fundRate != null) {
    return `${parseFloat(commRate.toFixed(3))}/${parseFloat(fundRate.toFixed(3))}%`;
  }
  return formatRate(item.annualRate ?? commRate ?? fundRate);
}

function formatLoanPart(part: PaymentScheduleItem['loanPart'] | RateSegmentSummary['loanPart']): string {
  if (part === 'commercial') return '商贷';
  if (part === 'fund') return '公积金';
  return '-';
}

function getSubSchedule(plan: LoanPlan, part: LoanPart): PaymentScheduleItem[] {
  return plan.schedule
    .map((item) => item[part])
    .filter((item): item is PaymentScheduleItem => item != null);
}

function sumInterestFrom(schedule: PaymentScheduleItem[], index: number): number {
  return schedule.slice(Math.max(0, index)).reduce((total, item) => total + item.interest, 0);
}

function getRatePartCompare(result: { originalPlan: LoanPlan; adjustedPlan: LoanPlan }, part: LoanPart, effectiveDate: string) {
  const oldSchedule = getSubSchedule(result.originalPlan, part);
  const newSchedule = getSubSchedule(result.adjustedPlan, part);
  const oldIndex = Math.max(0, oldSchedule.findIndex((item) => item.date >= effectiveDate));
  const newIndex = Math.max(0, newSchedule.findIndex((item) => item.date >= effectiveDate));
  const oldItem = oldSchedule[oldIndex] || oldSchedule[oldSchedule.length - 1];
  const newItem = newSchedule[newIndex] || newSchedule[newSchedule.length - 1];
  const oldRemainingInterest = sumInterestFrom(oldSchedule, oldIndex);
  const newRemainingInterest = sumInterestFrom(newSchedule, newIndex);

  return {
    part,
    oldMonthlyPayment: oldItem?.payment || 0,
    newMonthlyPayment: newItem?.payment || 0,
    monthlyPaymentDiff: (newItem?.payment || 0) - (oldItem?.payment || 0),
    oldRemainingInterest,
    newRemainingInterest,
    interestDiff: newRemainingInterest - oldRemainingInterest,
    oldEndDate: oldSchedule[oldSchedule.length - 1]?.date || '-',
    newEndDate: newSchedule[newSchedule.length - 1]?.date || '-',
  };
}

function App() {
  const [scenario, setScenario] = useState<ScenarioKey>(() => loadStoredValue(`${STORAGE_PREFIX}:scenario`, 'active'));
  const [form, setForm] = useState(() => ({
    ...defaultForm,
    ...loadStoredValue(`${STORAGE_PREFIX}:form`, defaultForm),
  }));
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [showAdvancedLoanFields, setShowAdvancedLoanFields] = useState(false);
  const [isHistoryPanelCollapsed, setIsHistoryPanelCollapsed] = useState(false);
  const [isRealScheduleCollapsed, setIsRealScheduleCollapsed] = useState(false);
  const [prepayInput, setPrepayInput] = useState<{
    date: string;
    amountWan: number;
    target: LoanPart;
    includeCurrentMonthPayment: boolean;
    penaltyFee: number;
  }>(() => loadStoredValue(`${STORAGE_PREFIX}:prepay`, defaultPrepayInput));
  const [rateInput, setRateInput] = useState(() => loadStoredValue(`${STORAGE_PREFIX}:rate`, defaultRateInput));
  const [budgetInput, setBudgetInput] = useState(() => loadStoredValue(`${STORAGE_PREFIX}:budget`, defaultBudgetInput));
  const [historyEvents, setHistoryEvents] = useState<HistoricalLoanEvent[]>(() => {
    const stored = loadStoredValue(`${STORAGE_PREFIX}:history`, defaultHistoryEvents);
    if (Array.isArray(stored)) return stored;
    removeStoredValue(`${STORAGE_PREFIX}:history`);
    return defaultHistoryEvents;
  });

  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:scenario`, scenario), [scenario]);
  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:form`, form), [form]);
  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:prepay`, prepayInput), [prepayInput]);
  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:rate`, rateInput), [rateInput]);
  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:budget`, budgetInput), [budgetInput]);
  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:history`, historyEvents), [historyEvents]);
  useEffect(() => {
    const allowedTabs = scenario === 'planning' ? planningTabs : activeLoanTabs;
    if (!allowedTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(allowedTabs[0].key);
    }
  }, [activeTab, scenario]);

  const planResult = useMemo(() => {
    try {
      return {
        plan: calculateMortgagePlan(toLoanInput(form, {
          firstPaymentDate: form.firstPaymentDate,
          annualRate: form.annualRate,
        })),
        error: '',
      };
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : '计算失败' };
    }
  }, [form, scenario]);

  const budgetResult = useMemo(() => {
    try {
      return { result: calculateBudgetReverse(budgetInput), error: '' };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '预算反推计算失败' };
    }
  }, [budgetInput]);

  const historyResult = useMemo(() => {
    if (!planResult.plan) return { result: null, error: planResult.error };
    try {
      return {
        result: calculateHistoricalLoanPlan(toLoanInput(form), historyEvents),
        error: '',
      };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '历史变动计算失败' };
    }
  }, [form, historyEvents, planResult]);

  const plan = planResult.plan;
  const hasHistory = scenario === 'active' && showAdvancedLoanFields && historyEvents.length > 0;
  const actualPlan = hasHistory && historyResult.result ? historyResult.result.adjustedPlan : plan;
  const displayPlan = actualPlan || plan;
  const currentPaymentItem = displayPlan ? getCurrentPaymentItem(displayPlan.schedule) : undefined;
  const today = formatDate(new Date());
  const actualPaidSchedule = hasHistory && actualPlan
    ? actualPlan.schedule.filter((item) => item.date <= today)
    : actualPlan?.schedule || [];
  const rateSegments = hasHistory ? buildRateSegmentSummary(actualPaidSchedule) : (actualPlan ? buildRateSegmentSummary(actualPlan.schedule) : []);
  const actualAnnualSummary = actualPlan?.annualSummary || [];
  const prepaySubtitle = form.loanType === 'combined'
    ? `${describePrepay(prepayInput.date, prepayInput.amountWan)} · ${formatLoanPart(prepayInput.target)}`
    : describePrepay(prepayInput.date, prepayInput.amountWan);

  const prepayComparison = useMemo(() => {
    if (!actualPlan) return { result: null, error: planResult.error };
    try {
      return {
        result: calculatePrepaymentComparison(actualPlan, {
          date: prepayInput.date,
          amount: wanToYuan(prepayInput.amountWan),
          ...(form.loanType === 'combined' ? { target: prepayInput.target } : {}),
          includeCurrentMonthPayment: prepayInput.includeCurrentMonthPayment,
          penaltyFee: prepayInput.penaltyFee,
        }),
        error: '',
      };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '提前还款计算失败' };
    }
  }, [actualPlan, planResult.error, prepayInput]);

  const projectedRateResult = useMemo(() => {
    if (!actualPlan) return { result: null, error: planResult.error };
    try {
      return {
        result: calculateRateAdjustedPlan(actualPlan, {
          effectiveDate: rateInput.effectiveDate,
          newAnnualRate: rateInput.newAnnualRate,
          ...(form.loanType === 'combined' ? {
            newCommercialRate: rateInput.newCommercialRate ?? form.commercialRate,
            newFundRate: rateInput.newFundRate ?? form.fundRate,
          } : {}),
        }),
        error: '',
      };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '利率调整计算失败' };
    }
  }, [actualPlan, planResult.error, rateInput, form.loanType, form.commercialRate, form.fundRate]);

  const ratePartCompares = form.loanType === 'combined' && projectedRateResult.result
    ? (['commercial', 'fund'] as const).map((part) => getRatePartCompare(projectedRateResult.result!, part, rateInput.effectiveDate))
    : [];
  const rateCompareRows: CompareRow[] = projectedRateResult.result
    ? (form.loanType === 'combined' && ratePartCompares.length > 0
      ? [
          ...ratePartCompares.map((item) => ({
            label: `${formatLoanPart(item.part)}月供`,
            values: [
              formatMoney(item.oldMonthlyPayment),
              formatMoney(item.newMonthlyPayment),
              formatMoneyDiff(item.monthlyPaymentDiff),
            ],
          })),
          {
            label: '合计月供',
            values: [
              formatMoney(projectedRateResult.result.compare.oldMonthlyPayment),
              formatMoney(projectedRateResult.result.compare.newMonthlyPayment),
              formatMoneyDiff(projectedRateResult.result.compare.monthlyPaymentDiff),
            ],
          },
          ...ratePartCompares.map((item) => ({
            label: `${formatLoanPart(item.part)}剩余利息`,
            values: [
              formatMoney(item.oldRemainingInterest),
              formatMoney(item.newRemainingInterest),
              formatMoneyDiff(item.interestDiff),
            ],
          })),
          {
            label: '合计剩余利息',
            values: [
              formatMoney(projectedRateResult.result.compare.oldRemainingInterest),
              formatMoney(projectedRateResult.result.compare.newRemainingInterest),
              formatMoneyDiff(projectedRateResult.result.compare.interestDiff),
            ],
          },
          ...ratePartCompares.map((item) => ({
            label: `${formatLoanPart(item.part)}还清日期`,
            values: [
              item.oldEndDate,
              item.newEndDate,
              item.oldEndDate === item.newEndDate ? '不变' : item.newEndDate,
            ],
          })),
          {
            label: '总还清日期',
            values: [
              projectedRateResult.result.compare.oldEndDate,
              projectedRateResult.result.compare.newEndDate,
              projectedRateResult.result.compare.oldEndDate === projectedRateResult.result.compare.newEndDate ? '不变' : projectedRateResult.result.compare.newEndDate,
            ],
          },
        ]
      : [
          {
            label: '鏈堜緵',
            values: [
              formatMoney(projectedRateResult.result.compare.oldMonthlyPayment),
              formatMoney(projectedRateResult.result.compare.newMonthlyPayment),
              formatMoneyDiff(projectedRateResult.result.compare.monthlyPaymentDiff),
            ],
          },
          {
            label: '鍓╀綑鍒╂伅',
            values: [
              formatMoney(projectedRateResult.result.compare.oldRemainingInterest),
              formatMoney(projectedRateResult.result.compare.newRemainingInterest),
              formatMoneyDiff(projectedRateResult.result.compare.interestDiff),
            ],
          },
          {
            label: '杩樻竻鏃ユ湡',
            values: [
              projectedRateResult.result.compare.oldEndDate,
              projectedRateResult.result.compare.newEndDate,
              projectedRateResult.result.compare.oldEndDate === projectedRateResult.result.compare.newEndDate ? '涓嶅彉' : projectedRateResult.result.compare.newEndDate,
            ],
          },
        ])
    : [];

  const updateForm = (patch: Partial<LoanFormState>) => setForm((current) => ({ ...current, ...patch }));
  const updateHistoryEvent = (id: string, patch: Partial<HistoricalLoanEvent>) => {
    setHistoryEvents((events) => events.map((event) => {
      if (event.id !== id) return event;
      return { ...event, ...patch } as HistoricalLoanEvent;
    }));
  };
  const changeHistoryEventType = (id: string, newType: HistoricalLoanEvent['type']) => {
    setHistoryEvents((events) => events.map((event) => {
      if (event.id !== id || event.type === newType) return event;
      const common = { id: event.id, date: event.date, penaltyFee: event.penaltyFee ?? 0, ...(event.target ? { target: event.target } : {}) };
      if (newType === 'rateChange') {
        const defaultRate = form.loanType === 'combined'
          ? (event.target === 'fund' ? form.fundRate : form.commercialRate)
          : form.annualRate;
        return { ...common, type: 'rateChange' as const, annualRate: defaultRate };
      }
      return { ...common, type: 'prepayment' as const, amount: wanToYuan(10), mode: 'reduceTerm' as const };
    }));
  };
  const addHistoryEvent = (type: HistoricalLoanEvent['type'], target?: 'commercial' | 'fund') => {
    const isCombined = form.loanType === 'combined';
    const effectiveTarget = isCombined ? (target ?? 'commercial') : undefined;
    const sortedRateEvents = historyEvents
      .filter((event): event is Extract<HistoricalLoanEvent, { type: 'rateChange' }> => event.type === 'rateChange')
      .filter((event) => !isCombined || !effectiveTarget || !event.target || event.target === effectiveTarget)
      .sort((a, b) => a.date.localeCompare(b.date));
    const defaultRate = isCombined
      ? (effectiveTarget === 'fund' ? form.fundRate : form.commercialRate)
      : form.annualRate;
    const latestRate = sortedRateEvents[sortedRateEvents.length - 1]?.annualRate ?? defaultRate;
    const latestDate = historyEvents.length > 0
      ? [...historyEvents].sort((a, b) => a.date.localeCompare(b.date))[historyEvents.length - 1]?.date
      : form.firstPaymentDate;
    setHistoryEvents((events) => [
      ...events,
      type === 'rateChange'
        ? { id: `rate-${Date.now()}`, type, date: latestDate, annualRate: latestRate, penaltyFee: 0, ...(effectiveTarget ? { target: effectiveTarget } : {}) }
        : { id: `prepay-${Date.now()}`, type, date: latestDate, amount: wanToYuan(10), mode: 'reduceTerm' as const, penaltyFee: 0, ...(effectiveTarget ? { target: effectiveTarget } : {}) },
    ]);
  };
  const removeHistoryEvent = (id: string) => setHistoryEvents((events) => events.filter((event) => event.id !== id));
  const resetAllInputs = () => {
    removeStoredValue(`${STORAGE_PREFIX}:scenario`);
    removeStoredValue(`${STORAGE_PREFIX}:form`);
    removeStoredValue(`${STORAGE_PREFIX}:prepay`);
    removeStoredValue(`${STORAGE_PREFIX}:rate`);
    removeStoredValue(`${STORAGE_PREFIX}:budget`);
    removeStoredValue(`${STORAGE_PREFIX}:history`);
    setScenario('active');
    setForm(defaultForm);
    setPrepayInput(defaultPrepayInput);
    setRateInput(defaultRateInput);
    setBudgetInput(defaultBudgetInput);
    setHistoryEvents(defaultHistoryEvents);
    setActiveTab('schedule');
  };

  const remainingFromCurrent = useMemo(() => {
    if (!displayPlan || !currentPaymentItem) return null;
    const future = displayPlan.schedule.filter((item) => item.period >= currentPaymentItem.period);
    const remainingPrincipal = future.reduce((acc, item) => acc + item.principal + (item.extraPrincipal || 0), 0);
    const remainingInterest = future.reduce((acc, item) => acc + item.interest, 0);
    return {
      monthlyPayment: currentPaymentItem.payment,
      remainingPeriods: future.length,
      remainingPrincipal,
      remainingInterest,
      remainingPayment: remainingPrincipal + remainingInterest,
      endDate: displayPlan.summary.endDate,
    };
  }, [displayPlan, currentPaymentItem]);
  const tabs = scenario === 'planning' ? planningTabs : activeLoanTabs;
  const isHistoryMode = scenario === 'active' && showAdvancedLoanFields;

  return (
    <main className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">房贷参谋</h1>
            <p className="hidden text-sm text-slate-500 dark:text-slate-400 sm:block">
              {scenario === 'planning' ? '估算将要贷款的月供和总成本' : '按初始贷款信息复盘还款计划'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
              所有计算在本地浏览器完成
            </span>
            <Tooltip text="清空缓存并恢复默认" position="bottom">
              <button
                type="button"
                aria-label="清空缓存并恢复默认"
                className="inline-flex min-h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={resetAllInputs}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </Tooltip>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          <aside className="space-y-4 lg:sticky lg:top-5">
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
          <SegmentedButton
            value={scenario}
            onChange={(nextScenario) => {
              setScenario(nextScenario);
              setShowAdvancedLoanFields(false);
              setActiveTab('schedule');
            }}
            options={[
              { value: 'active', label: '已贷款' },
              { value: 'planning', label: '准备贷款' },
            ]}
          />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-none md:p-5">
          <div className="mb-4 flex flex-col gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                {scenario === 'planning' ? '贷款方案' : isHistoryMode ? '初始贷款信息' : '当前还款状态'}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {scenario === 'planning'
                  ? '输入计划贷款金额、年限和利率，先看月供与总成本。'
                  : isHistoryMode
                    ? '输入原始贷款信息，并补充利率变化和提前还款。'
                    : '输入当前剩余信息，快速测算未来月供和还款变化。'}
              </p>
            </div>
            {scenario === 'active' ? (
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                <span className="font-medium">还款历史</span>
                <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${showAdvancedLoanFields ? 'bg-blue-700 dark:bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={showAdvancedLoanFields}
                    onChange={(event) => setShowAdvancedLoanFields(event.target.checked)}
                  />
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition ${showAdvancedLoanFields ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </span>
              </label>
            ) : null}
          </div>

          <div className="grid gap-4">
            <div>
              <span className={labelBase}>贷款类型</span>
              <SegmentedButton
                value={form.loanType}
                onChange={(loanType) => updateForm({ loanType })}
                options={[
                  { value: 'commercial', label: '商贷' },
                  { value: 'fund', label: '公积金' },
                  { value: 'combined', label: '组合贷' },
                ]}
              />
            </div>
            <div>
              <span className={labelBase}>还款方式</span>
              <SegmentedButton
                value={form.repaymentMethod}
                onChange={(repaymentMethod) => updateForm({ repaymentMethod })}
                options={[
                  { value: 'equalPayment', label: '等额本息', tooltip: repaymentExplanation.equalPayment },
                  { value: 'equalPrincipal', label: '等额本金', tooltip: repaymentExplanation.equalPrincipal },
                ]}
              />
            </div>
            {scenario === 'planning' ? (
              <div>
                <Field label="首次还款日">
                  <input
                    className={dateInputClass}
                    type="date"
                    value={form.firstPaymentDate}
                    onClick={openDatePicker}
                    onChange={(event) => updateForm({ firstPaymentDate: event.target.value })}
                  />
                </Field>
              </div>
            ) : (
              <div>
                <Field label={isHistoryMode ? '首次还款日' : '下次还款日'}>
                  <input
                    className={dateInputClass}
                    type="date"
                    value={form.firstPaymentDate}
                    onClick={openDatePicker}
                    onChange={(event) => updateForm({ firstPaymentDate: event.target.value })}
                  />
                </Field>
              </div>
            )}
          </div>

          {form.loanType === 'combined' ? (
            <div className="mt-5 grid gap-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {scenario === 'planning' ? '商业贷款' : isHistoryMode ? '商业贷款初始部分' : '商业贷款剩余部分'}
                </h2>
                <div className="grid gap-4">
                  <Field label={scenario === 'planning' ? '贷款金额（万元）' : isHistoryMode ? '原始贷款金额（万元）' : '当前剩余本金（万元）'}>
                    <input
                      className={baseInputClass}
                      type="number"
                      min="0"
                      value={form.commercialAmountWan}
                      onChange={(event) => updateForm({ commercialAmountWan: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={scenario === 'planning' ? '贷款年限（年）' : isHistoryMode ? '原始贷款年限（年）' : '剩余年限（年）'}>
                    <Slider
                      value={form.commercialYears}
                      onChange={(commercialYears) => updateForm({ commercialYears })}
                      min={YEAR_MIN}
                      max={YEAR_MAX}
                      step={1}
                      suffix=" 年"
                      ariaLabel="商贷年限"
                    />
                  </Field>
                  <Field label={scenario === 'planning' ? '年利率（%）' : isHistoryMode ? '初始年利率（%）' : '当前年利率（%）'}>
                    <Slider
                      value={form.commercialRate}
                      onChange={(commercialRate) => updateForm({ commercialRate })}
                      min={RATE_MIN}
                      max={RATE_MAX}
                      step={RATE_STEP}
                      suffix="%"
                      decimals={3}
                      ariaLabel="商贷年利率"
                    />
                  </Field>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {scenario === 'planning' ? '公积金贷款' : isHistoryMode ? '公积金贷款初始部分' : '公积金贷款剩余部分'}
                </h2>
                <div className="grid gap-4">
                  <Field label={scenario === 'planning' ? '贷款金额（万元）' : isHistoryMode ? '原始贷款金额（万元）' : '当前剩余本金（万元）'}>
                    <input
                      className={baseInputClass}
                      type="number"
                      min="0"
                      value={form.fundAmountWan}
                      onChange={(event) => updateForm({ fundAmountWan: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={scenario === 'planning' ? '贷款年限（年）' : isHistoryMode ? '原始贷款年限（年）' : '剩余年限（年）'}>
                    <Slider
                      value={form.fundYears}
                      onChange={(fundYears) => updateForm({ fundYears })}
                      min={YEAR_MIN}
                      max={YEAR_MAX}
                      step={1}
                      suffix=" 年"
                      ariaLabel="公积金贷年限"
                    />
                  </Field>
                  <Field label={scenario === 'planning' ? '年利率（%）' : isHistoryMode ? '初始年利率（%）' : '当前年利率（%）'}>
                    <Slider
                      value={form.fundRate}
                      onChange={(fundRate) => updateForm({ fundRate })}
                      min={RATE_MIN}
                      max={RATE_MAX}
                      step={RATE_STEP}
                      suffix="%"
                      decimals={3}
                      ariaLabel="公积金年利率"
                    />
                  </Field>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-4">
              <Field label={scenario === 'planning' ? '贷款金额（万元）' : isHistoryMode ? '原始贷款金额（万元）' : '当前剩余本金（万元）'}>
                <input
                  className={baseInputClass}
                  type="number"
                  min="0"
                  value={form.amountWan}
                  onChange={(event) => updateForm({ amountWan: Number(event.target.value) })}
                />
              </Field>
              <Field label={scenario === 'planning' ? '贷款年限（年）' : isHistoryMode ? '原始贷款年限（年）' : '剩余年限（年）'}>
                <Slider
                  value={form.years}
                  onChange={(years) => updateForm({ years })}
                  min={YEAR_MIN}
                  max={YEAR_MAX}
                  step={1}
                  suffix=" 年"
                  ariaLabel={scenario === 'planning' ? '贷款年限' : isHistoryMode ? '原始贷款年限' : '剩余年限'}
                />
              </Field>
              <Field label={scenario === 'planning' ? '年利率（%）' : isHistoryMode ? '初始年利率（%）' : '当前年利率（%）'}>
                <Slider
                  value={form.annualRate}
                  onChange={(annualRate) => updateForm({ annualRate })}
                  min={RATE_MIN}
                  max={RATE_MAX}
                  step={RATE_STEP}
                  suffix="%"
                  decimals={3}
                  ariaLabel="贷款年利率"
                />
              </Field>
            </div>
          )}

        </section>
          </aside>

          <div className="flex min-w-0 flex-col gap-5">

        {planResult.error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
            {planResult.error}
          </div>
        ) : null}

        {plan ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title={scenario === 'planning' ? '预计月供' : '当前月供'}
                value={formatMoney(currentPaymentItem?.payment || displayPlan?.summary.monthlyPayment || 0)}
                desc={currentPaymentItem ? `${currentPaymentItem.date}，${getPaymentItemRateDesc(currentPaymentItem, form.loanType)}` : '按当前方案'}
                icon={WalletCards}
              />
              <StatCard
                title={scenario === 'planning' ? '贷款本金' : '剩余本金'}
                value={formatMoney(scenario === 'planning' ? displayPlan?.summary.totalPrincipal || 0 : remainingFromCurrent?.remainingPrincipal || 0, { unit: 'wan' })}
                desc={scenario === 'planning' ? '本金合计' : '按当前剩余计划'}
                icon={PiggyBank}
              />
              <StatCard
                title={scenario === 'planning' ? '总利息' : '剩余利息'}
                value={formatMoney(scenario === 'planning' ? displayPlan?.summary.totalInterest || 0 : remainingFromCurrent?.remainingInterest || 0, { unit: 'wan' })}
                desc={scenario === 'planning' ? '完整贷款周期' : '按当前剩余计划'}
                icon={LineChart}
              />
              <StatCard
                title={scenario === 'planning' ? '总还款' : '剩余本息'}
                value={formatMoney(scenario === 'planning' ? displayPlan?.summary.totalPayment || 0 : remainingFromCurrent?.remainingPayment || 0, { unit: 'wan' })}
                desc="本金 + 利息"
                icon={Banknote}
              />
            </section>

            {isHistoryMode ? (
              <section className="rounded-lg border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => setIsHistoryPanelCollapsed((current) => !current)}
                  aria-expanded={!isHistoryPanelCollapsed}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <CalendarDays size={20} className="shrink-0 text-blue-700 dark:text-blue-300" aria-hidden />
                    <div>
                      <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">历史利率变动</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">补充过去的利率调整和提前还款</p>
                    </div>
                  </div>
                  <span className="text-sm text-slate-500 dark:text-slate-400">{isHistoryPanelCollapsed ? '展开' : '收起'}</span>
                </button>

                {!isHistoryPanelCollapsed ? (
                  <div className="space-y-4 border-t border-slate-200 p-4 dark:border-slate-700">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="min-h-9 rounded-md bg-blue-700 px-3 text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
                        onClick={() => addHistoryEvent('rateChange')}
                      >
                        添加变动
                      </button>
                    </div>

                    {historyEvents.length === 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                        暂无历史变动。点击"添加变动"后，在类型处选择利率变化或提前还款。
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                        <div className="hidden bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400 lg:grid lg:grid-cols-[6.5rem_10rem_minmax(12rem,1fr)_8rem_8rem_2.75rem] lg:gap-2">
                          <span>类型</span>
                          <span>日期</span>
                          <span>年利率 / 金额</span>
                          <span>处理方式</span>
                          <span className="text-right">违约金</span>
                          <span className="text-right">操作</span>
                        </div>
                        {historyEvents.map((event) => (
                          <div
                            key={event.id}
                            className="grid gap-2 border-t border-slate-200 p-3 dark:border-slate-700 lg:grid-cols-[6.5rem_10rem_minmax(12rem,1fr)_8rem_8rem_2.75rem] lg:items-center"
                          >
                            <div className="flex flex-col gap-1.5">
                              <select
                                className={`h-7 rounded-md border px-1.5 text-xs font-medium ${event.type === 'rateChange' ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300'}`}
                                value={event.type}
                                onChange={(e) => changeHistoryEventType(event.id, e.target.value as HistoricalLoanEvent['type'])}
                              >
                                <option value="rateChange">利率变化</option>
                                <option value="prepayment">提前还款</option>
                              </select>
                              {form.loanType === 'combined' ? (
                                <select
                                  className="h-7 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                                  value={event.target ?? 'commercial'}
                                  onChange={(changeEvent) => updateHistoryEvent(event.id, { target: changeEvent.target.value as 'commercial' | 'fund' } as Partial<HistoricalLoanEvent>)}
                                >
                                  <option value="commercial">商贷</option>
                                  <option value="fund">公积金</option>
                                </select>
                              ) : null}
                            </div>
                            <Field label="日期" className="lg:[&>span]:sr-only">
                                <input
                                  className={`${dateInputClass} h-9`}
                                  type="date"
                                  value={event.date}
                                  onClick={openDatePicker}
                                  onChange={(changeEvent) => updateHistoryEvent(event.id, { date: changeEvent.target.value })}
                                />
                            </Field>
                            {event.type === 'rateChange' ? (
                              <Field label="年利率（%）" className="lg:[&>span]:sr-only">
                                <Slider
                                  value={event.annualRate}
                                  onChange={(annualRate) => updateHistoryEvent(event.id, { annualRate } as Partial<HistoricalLoanEvent>)}
                                  min={RATE_MIN}
                                  max={RATE_MAX}
                                  step={RATE_STEP}
                                  suffix="%"
                                  decimals={3}
                                  ariaLabel="历史年利率"
                                />
                              </Field>
                            ) : (
                              <Field label="金额（万元）" className="lg:[&>span]:sr-only">
                                <input
                                  className={`${baseInputClass} h-9`}
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  value={event.amount / 10000}
                                  onChange={(changeEvent) =>
                                    updateHistoryEvent(event.id, { amount: wanToYuan(Number(changeEvent.target.value)) } as Partial<HistoricalLoanEvent>)
                                  }
                                />
                              </Field>
                            )}
                            <Field label="处理方式" className="lg:[&>span]:sr-only">
                              {event.type === 'prepayment' ? (
                                <select
                                  className={`${baseInputClass} h-9`}
                                  value={event.mode}
                                  onChange={(changeEvent) =>
                                    updateHistoryEvent(event.id, { mode: changeEvent.target.value as PrepaymentMode } as Partial<HistoricalLoanEvent>)
                                  }
                                >
                                  <option value="reduceTerm">减少年限</option>
                                  <option value="reducePayment">减少月供</option>
                                </select>
                              ) : (
                                <span className="flex h-9 items-center text-slate-400 dark:text-slate-500">-</span>
                              )}
                            </Field>
                            <Field label="违约金" className="lg:[&>span]:sr-only">
                              <input
                                className={`${baseInputClass} h-9 text-right`}
                                type="number"
                                min="0"
                                value={event.penaltyFee || 0}
                                onChange={(changeEvent) =>
                                  updateHistoryEvent(event.id, { penaltyFee: Number(changeEvent.target.value) } as Partial<HistoricalLoanEvent>)
                                }
                              />
                            </Field>
                            <button
                              type="button"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                              onClick={() => removeHistoryEvent(event.id)}
                              aria-label="删除"
                            >
                              <Trash2 size={14} aria-hidden />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-lg border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
              <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`min-h-11 shrink-0 rounded-md px-4 text-sm font-medium transition ${
                      activeTab === tab.key
                        ? 'bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50'
                    }`}
                    aria-pressed={activeTab === tab.key}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-4 md:p-5">
                {activeTab === 'schedule' ? (
                  <div className="space-y-4">
                    {hasHistory ? (
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                        <button
                          type="button"
                          className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          onClick={() => setIsRealScheduleCollapsed((current) => !current)}
                          aria-expanded={!isRealScheduleCollapsed}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Landmark size={20} className="shrink-0 text-blue-700 dark:text-blue-300" aria-hidden />
                            <span className="min-w-0">
                              <span className="block text-base font-semibold text-slate-950 dark:text-slate-50">真实还款明细</span>
                              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">已纳入历史利率变化、已发生提前还款和违约金。</span>
                            </span>
                          </span>
                          <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{isRealScheduleCollapsed ? '展开' : '收起'}</span>
                        </button>
                        {!isRealScheduleCollapsed ? (
                          <div className="border-t border-slate-200 dark:border-slate-700">
                            {historyResult.error ? (
                              <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
                                {historyResult.error}
                              </div>
                            ) : null}
                            <div className="overflow-x-auto">
                              <table className="advisor-data-table w-full table-fixed text-xs">
                            <colgroup>
                              <col className="w-[21%]" />
                              <col className="w-[13%]" />
                              <col className="w-[6%]" />
                              <col className="w-[11%]" />
                              <col className="w-[11%]" />
                              <col className="w-[11%]" />
                              <col className="w-[11%]" />
                              <col className="w-[7%]" />
                              <col className="w-[9%]" />
                            </colgroup>
                            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              <tr>
                                <th className="px-2 py-3 text-left font-medium">利率阶段</th>
                                <th className="px-2 py-3 text-right font-medium">利率</th>
                                <th className="px-2 py-3 text-right font-medium">期数</th>
                                <th className="px-2 py-3 text-right font-medium">还款额</th>
                                <th className="px-2 py-3 text-right font-medium">本金</th>
                                <th className="px-2 py-3 text-right font-medium">利息</th>
                                <th className="px-2 py-3 text-right font-medium">提前还本</th>
                                <th className="px-2 py-3 text-right font-medium">违约金</th>
                                <th className="px-2 py-3 text-right font-medium">段末剩余</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rateSegments.map((segment) => (
                                      <tr key={`${segment.startDate}-${segment.commercialRate ?? ''}-${segment.fundRate ?? ''}-${segment.annualRate}`} className="border-t border-slate-200 dark:border-slate-700">
                                  <td className="date-cell px-2 py-3 text-slate-700 dark:text-slate-200" title={`${segment.startDate} 至 ${segment.endDate}`}>
                                    <span className="block">{segment.startDate} ~ {segment.endDate}</span>
                                    {segment.loanPart ? (
                                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">{formatLoanPart(segment.loanPart)}</span>
                                    ) : null}
                                  </td>
                                  <td className="money-figures rate-cell px-2 py-3 text-right">{formatSegmentRate(segment)}</td>
                                  <td className="money-figures px-2 py-3 text-right">{segment.periods}</td>
                                  <td className="money-figures px-2 py-3 text-right">{formatMoneyPlain(segment.totalPayment)}</td>
                                  <td className="money-figures px-2 py-3 text-right">{formatMoneyPlain(segment.totalPrincipal)}</td>
                                  <td className="money-figures px-2 py-3 text-right">{formatMoneyPlain(segment.totalInterest)}</td>
                                  <td className="money-figures px-2 py-3 text-right">{segment.totalExtraPrincipal ? formatMoneyPlain(segment.totalExtraPrincipal) : '-'}</td>
                                  <td className="money-figures px-2 py-3 text-right">{segment.totalPenaltyFee ? formatMoneyPlain(segment.totalPenaltyFee) : '-'}</td>
                                  <td className="money-figures px-2 py-3 text-right">{formatMoneyPlain(segment.endRemainingPrincipal)}</td>
                                </tr>
                              ))}
                            </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                        <BarChart2 size={20} className="shrink-0 text-blue-700 dark:text-blue-300" aria-hidden />
                        <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">年度汇总</h3>
                      </div>
                      <div>
                        {actualAnnualSummary.map((year) => (
                          <div key={year.year} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
                            <button
                              type="button"
                              className="grid min-h-14 w-full grid-cols-2 gap-3 bg-white px-4 py-3 text-left transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 md:grid-cols-5"
                              onClick={() => setExpandedYear(expandedYear === year.year ? null : year.year)}
                              aria-expanded={expandedYear === year.year}
                            >
                              <span className="font-medium text-slate-950 dark:text-slate-50">{year.year} 年</span>
                              <span className="money-figures text-sm text-slate-600 dark:text-slate-300">还款 {formatMoneyPlain(year.totalPayment)}</span>
                              <span className="money-figures text-sm text-slate-600 dark:text-slate-300">本金 {formatMoneyPlain(year.totalPrincipal)}</span>
                              <span className="money-figures text-sm text-slate-600 dark:text-slate-300">利息 {formatMoneyPlain(year.totalInterest)}</span>
                              <span className="money-figures text-sm text-slate-600 dark:text-slate-300">剩余 {formatMoneyPlain(year.endRemainingPrincipal)}</span>
                            </button>
                            {expandedYear === year.year ? (
                              <div className="overflow-hidden bg-slate-50 p-3 dark:bg-slate-800/40">
                                <table className="advisor-data-table w-full table-fixed text-xs">
                                  <colgroup>
                                    <col className="w-[7%]" />
                                    <col className="w-[14%]" />
                                    <col className="w-[8%]" />
                                    <col className="w-[10%]" />
                                    <col className="w-[10%]" />
                                    <col className="w-[10%]" />
                                    <col className="w-[11%]" />
                                    <col className="w-[10%]" />
                                    <col className="w-[12%]" />
                                  </colgroup>
                                  <thead className="text-slate-500 dark:text-slate-400">
                                    <tr>
                                      <th className="px-3 py-2 text-left font-medium">期数</th>
                                      <th className="px-3 py-2 text-left font-medium">日期</th>
                                      <th className="px-3 py-2 text-right font-medium">利率</th>
                                      <th className="px-3 py-2 text-right font-medium">月供</th>
                                      <th className="px-3 py-2 text-right font-medium">本金</th>
                                      <th className="px-3 py-2 text-right font-medium">利息</th>
                                      <th className="px-3 py-2 text-right font-medium">提前还本</th>
                                      <th className="px-3 py-2 text-right font-medium">违约金</th>
                                      <th className="px-3 py-2 text-right font-medium">剩余本金</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {year.months.map((month) => (
                                      <tr key={month.period} className="border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                                        <td className="px-3 py-2">{month.period}</td>
                                        <td className="date-cell px-2 py-2">
                                          <span className="block">{month.date}</span>
                                          {month.loanPart ? (
                                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">{formatLoanPart(month.loanPart)}</span>
                                          ) : null}
                                        </td>
                                        <td className="money-figures px-3 py-2 text-right">{formatPaymentItemRate(month)}</td>
                                        <td className="money-figures px-2 py-2 text-right">{formatMoneyPlain(month.payment)}</td>
                                        <td className="money-figures px-2 py-2 text-right">{formatMoneyPlain(month.principal)}</td>
                                        <td className="money-figures px-2 py-2 text-right">{formatMoneyPlain(month.interest)}</td>
                                        <td className="money-figures px-2 py-2 text-right">{month.extraPrincipal ? formatMoneyPlain(month.extraPrincipal) : '-'}</td>
                                        <td className="money-figures px-2 py-2 text-right">{month.penaltyFee ? formatMoneyPlain(month.penaltyFee) : '-'}</td>
                                        <td className="money-figures px-2 py-2 text-right">{formatMoneyPlain(month.remainingPrincipal)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {false && activeTab === 'schedule' && scenario === 'active' && showAdvancedLoanFields ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-2">
                        <CalendarDays size={20} className="text-blue-700 dark:text-blue-300" aria-hidden />
                        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">历史利率变动</h2>
                        <span className="text-xs text-slate-500 dark:text-slate-400">补充过去变化，用来生成真实还款轨迹</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="min-h-9 rounded-md bg-blue-700 px-3 text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
                          onClick={() => addHistoryEvent('rateChange')}
                        >
                          添加利率变化
                        </button>
                        <button
                          type="button"
                          className="min-h-9 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
                          onClick={() => addHistoryEvent('prepayment')}
                        >
                          添加提前还款
                        </button>
                      </div>
                    </div>

                    {form.loanType === 'combined' ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                        组合贷历史变动需要分别指定还商贷还是公积金贷，当前版本先支持商贷/公积金单贷。
                      </div>
                    ) : null}
                    {historyEvents.length === 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                        暂无历史变动。添加利率变化或已发生提前还款后，完整影响会统一体现在“还款明细”里。
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                        <table className="advisor-data-table w-full table-fixed text-xs">
                          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">类型</th>
                              <th className="px-3 py-2 text-left font-medium">日期</th>
                              <th className="px-3 py-2 text-left font-medium">年利率 / 金额</th>
                              <th className="px-3 py-2 text-left font-medium">处理方式</th>
                              <th className="px-3 py-2 text-right font-medium">违约金（元）</th>
                              <th className="px-3 py-2 text-right font-medium">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyEvents.map((event) => (
                              <tr key={event.id} className="border-t border-slate-200 align-middle dark:border-slate-700">
                                <td className="px-3 py-2">
                                  <span
                                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                                      event.type === 'rateChange'
                                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                                        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                    }`}
                                  >
                                    {event.type === 'rateChange' ? '利率变化' : '提前还款'}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                    <input
                                      className={`${dateInputClass} h-9`}
                                      type="date"
                                      value={event.date}
                                      onClick={openDatePicker}
                                      onChange={(changeEvent) => updateHistoryEvent(event.id, { date: changeEvent.target.value })}
                                    />
                                </td>
                                <td className="px-2 py-2">
                                  {event.type === 'rateChange' ? (
                                    <Slider
                                      value={event.annualRate}
                                      onChange={(annualRate) => updateHistoryEvent(event.id, { annualRate } as Partial<HistoricalLoanEvent>)}
                                      min={RATE_MIN}
                                      max={RATE_MAX}
                                      step={RATE_STEP}
                                      suffix="%"
                                      decimals={3}
                                      ariaLabel="历史年利率"
                                    />
                                  ) : (
                                    <input
                                      className={`${baseInputClass} h-9`}
                                      type="number"
                                      min="0"
                                      step="0.1"
                                      value={event.amount / 10000}
                                      onChange={(changeEvent) =>
                                        updateHistoryEvent(event.id, { amount: wanToYuan(Number(changeEvent.target.value)) } as Partial<HistoricalLoanEvent>)
                                      }
                                    />
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {event.type === 'prepayment' ? (
                                    <select
                                      className={`${baseInputClass} h-9`}
                                      value={event.mode}
                                      onChange={(changeEvent) =>
                                        updateHistoryEvent(event.id, { mode: changeEvent.target.value as PrepaymentMode } as Partial<HistoricalLoanEvent>)
                                      }
                                    >
                                      <option value="reduceTerm">减少年限</option>
                                      <option value="reducePayment">减少月供</option>
                                    </select>
                                  ) : (
                                    <span className="text-slate-400 dark:text-slate-500">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <input
                                    className={`${baseInputClass} h-9 w-28 text-right`}
                                    type="number"
                                    min="0"
                                    value={event.penaltyFee || 0}
                                    onChange={(changeEvent) =>
                                      updateHistoryEvent(event.id, { penaltyFee: Number(changeEvent.target.value) } as Partial<HistoricalLoanEvent>)
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    type="button"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                                    onClick={() => removeHistoryEvent(event.id)}
                                    aria-label="删除"
                                  >
                                    <Trash2 size={14} aria-hidden />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {historyEvents.length > 0 && !historyResult.error ? (
                      <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-800/40 dark:text-slate-300">
                        已记录 {historyEvents.length} 条历史变动。利率变化会在当月月供前生效，提前还款会在当月正常月供后扣减本金，违约金只计入现金支出、不抵扣本金；完整分段和月度明细请查看“还款明细”。
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeTab === 'prepay' ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <PiggyBank size={20} className="text-blue-700 dark:text-blue-300" aria-hidden />
                      <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">提前还款测算</h2>
                      <span className="text-xs text-slate-500 dark:text-slate-400">同一笔提前还款下两种处理方式对比</span>
                    </div>
                    {form.loanType === 'combined' ? (
                      <div className="max-w-xs">
                        <Field label="还款对象">
                          <select
                            className={baseInputClass}
                            value={prepayInput.target}
                            onChange={(event) => setPrepayInput((current) => ({ ...current, target: event.target.value as LoanPart }))}
                          >
                            <option value="commercial">商贷</option>
                            <option value="fund">公积金</option>
                          </select>
                        </Field>
                      </div>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="提前还款日期">
                          <input
                            className={dateInputClass}
                            type="date"
                            value={prepayInput.date}
                            onClick={openDatePicker}
                            onChange={(event) => setPrepayInput((current) => ({ ...current, date: event.target.value }))}
                          />
                      </Field>
                      <Field label="金额（万元）">
                        <input
                          className={baseInputClass}
                          type="number"
                          min="0"
                          value={prepayInput.amountWan}
                          onChange={(event) => setPrepayInput((current) => ({ ...current, amountWan: Number(event.target.value) }))}
                        />
                      </Field>
                      <Field label="当月月供">
                        <select
                          className={baseInputClass}
                          value={String(prepayInput.includeCurrentMonthPayment)}
                          onChange={(event) =>
                            setPrepayInput((current) => ({ ...current, includeCurrentMonthPayment: event.target.value === 'true' }))
                          }
                        >
                          <option value="true">正常偿还</option>
                          <option value="false">提前还前不还</option>
                        </select>
                      </Field>
                      <Field label="手续费（元）">
                        <input
                          className={baseInputClass}
                          type="number"
                          min="0"
                          value={prepayInput.penaltyFee}
                          onChange={(event) => setPrepayInput((current) => ({ ...current, penaltyFee: Number(event.target.value) }))}
                        />
                      </Field>
                    </div>
                    {prepayComparison.error || !prepayComparison.result ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
                        {prepayComparison.error}
                      </div>
                    ) : (
                      <MultiCompareTable
                        columns={[
                          {
                            title: '当前方案',
                            subtitle: '不提前还款',
                          },
                          {
                            title: '减少年限',
                            subtitle: '月供不变 · 缩短期限',
                            error: prepayComparison.result.reduceTermError,
                          },
                          { title: '年限差额' },
                          {
                            title: '减少月供',
                            subtitle: '期限不变 · 降低月供',
                            error: prepayComparison.result.reducePaymentError,
                          },
                          { title: '月供差额' },
                        ]}
                        rows={[
                          {
                            label: '剩余本金',
                            values: [
                              formatMoney(prepayComparison.result.reduceTerm?.compare.originalRemainingPrincipal || prepayComparison.result.reducePayment?.compare.originalRemainingPrincipal || 0),
                              prepayComparison.result.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingPrincipal) : undefined,
                              prepayComparison.result.reduceTerm
                                ? formatMoneyDiff(prepayComparison.result.reduceTerm.compare.adjustedRemainingPrincipal - prepayComparison.result.reduceTerm.compare.originalRemainingPrincipal)
                                : undefined,
                              prepayComparison.result.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingPrincipal) : undefined,
                              prepayComparison.result.reducePayment
                                ? formatMoneyDiff(prepayComparison.result.reducePayment.compare.adjustedRemainingPrincipal - prepayComparison.result.reducePayment.compare.originalRemainingPrincipal)
                                : undefined,
                            ],
                          },
                          {
                            label: '月供',
                            values: [
                              formatMoney(prepayComparison.result.reduceTerm?.compare.originalMonthlyPayment || prepayComparison.result.reducePayment?.compare.originalMonthlyPayment || 0),
                              prepayComparison.result.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedMonthlyPayment) : undefined,
                              prepayComparison.result.reduceTerm
                                ? formatMoneyDiff(prepayComparison.result.reduceTerm.compare.adjustedMonthlyPayment - prepayComparison.result.reduceTerm.compare.originalMonthlyPayment)
                                : undefined,
                              prepayComparison.result.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedMonthlyPayment) : undefined,
                              prepayComparison.result.reducePayment
                                ? formatMoneyDiff(prepayComparison.result.reducePayment.compare.adjustedMonthlyPayment - prepayComparison.result.reducePayment.compare.originalMonthlyPayment)
                                : undefined,
                            ],
                          },
                          {
                            label: '剩余期数',
                            values: [
                              `${prepayComparison.result.reduceTerm?.compare.originalRemainingPeriods || prepayComparison.result.reducePayment?.compare.originalRemainingPeriods || 0} 期`,
                              prepayComparison.result.reduceTerm ? `${prepayComparison.result.reduceTerm.compare.adjustedRemainingPeriods} 期` : undefined,
                              prepayComparison.result.reduceTerm
                                ? formatPeriodDiff(prepayComparison.result.reduceTerm.compare.adjustedRemainingPeriods - prepayComparison.result.reduceTerm.compare.originalRemainingPeriods)
                                : undefined,
                              prepayComparison.result.reducePayment ? `${prepayComparison.result.reducePayment.compare.adjustedRemainingPeriods} 期` : undefined,
                              prepayComparison.result.reducePayment
                                ? formatPeriodDiff(prepayComparison.result.reducePayment.compare.adjustedRemainingPeriods - prepayComparison.result.reducePayment.compare.originalRemainingPeriods)
                                : undefined,
                            ],
                          },
                          {
                            label: '剩余利息',
                            values: [
                              formatMoney(prepayComparison.result.reduceTerm?.compare.originalRemainingInterest || prepayComparison.result.reducePayment?.compare.originalRemainingInterest || 0),
                              prepayComparison.result.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingInterest) : undefined,
                              prepayComparison.result.reduceTerm
                                ? formatMoneyDiff(prepayComparison.result.reduceTerm.compare.adjustedRemainingInterest - prepayComparison.result.reduceTerm.compare.originalRemainingInterest)
                                : undefined,
                              prepayComparison.result.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingInterest) : undefined,
                              prepayComparison.result.reducePayment
                                ? formatMoneyDiff(prepayComparison.result.reducePayment.compare.adjustedRemainingInterest - prepayComparison.result.reducePayment.compare.originalRemainingInterest)
                                : undefined,
                            ],
                          },
                          {
                            label: '节省利息',
                            values: [
                              '-',
                              prepayComparison.result.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.savedInterest) : undefined,
                              prepayComparison.result.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.savedInterest) : undefined,
                              prepayComparison.result.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.savedInterest) : undefined,
                              prepayComparison.result.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.savedInterest) : undefined,
                            ],
                          },
                          {
                            label: '还清日期',
                            values: [
                              prepayComparison.result.reduceTerm?.compare.originalEndDate || prepayComparison.result.reducePayment?.compare.originalEndDate || '-',
                              prepayComparison.result.reduceTerm?.compare.adjustedEndDate,
                              prepayComparison.result.reduceTerm
                                ? formatEndDateDiff(prepayComparison.result.reduceTerm.compare.adjustedRemainingPeriods - prepayComparison.result.reduceTerm.compare.originalRemainingPeriods)
                                : undefined,
                              prepayComparison.result.reducePayment?.compare.adjustedEndDate,
                              prepayComparison.result.reducePayment
                                ? formatEndDateDiff(prepayComparison.result.reducePayment.compare.adjustedRemainingPeriods - prepayComparison.result.reducePayment.compare.originalRemainingPeriods)
                                : undefined,
                            ],
                          },
                        ]}
                      />
                    )}
                  </div>
                ) : null}

                {activeTab === 'rate' ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <LineChart size={20} className="text-blue-700 dark:text-blue-300" aria-hidden />
                      <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">利率调整测算</h2>
                    </div>
                    <div className={`grid gap-4 ${form.loanType === 'combined' ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                      <Field label="生效日期">
                          <input
                            className={dateInputClass}
                            type="date"
                            value={rateInput.effectiveDate}
                            onClick={openDatePicker}
                            onChange={(event) => setRateInput((current) => ({ ...current, effectiveDate: event.target.value }))}
                          />
                      </Field>
                      {form.loanType === 'combined' ? (
                        <>
                          <Field label="商贷年利率（%）">
                            <Slider
                              value={rateInput.newCommercialRate ?? form.commercialRate}
                              onChange={(newCommercialRate) => setRateInput((current) => ({ ...current, newCommercialRate }))}
                              min={RATE_MIN}
                              max={RATE_MAX}
                              step={RATE_STEP}
                              suffix="%"
                              decimals={3}
                              ariaLabel="商贷调整后年利率"
                            />
                          </Field>
                          <Field label="公积金年利率（%）">
                            <Slider
                              value={rateInput.newFundRate ?? form.fundRate}
                              onChange={(newFundRate) => setRateInput((current) => ({ ...current, newFundRate }))}
                              min={RATE_MIN}
                              max={RATE_MAX}
                              step={RATE_STEP}
                              suffix="%"
                              decimals={3}
                              ariaLabel="公积金调整后年利率"
                            />
                          </Field>
                        </>
                      ) : (
                        <Field label="年利率（%）">
                          <Slider
                            value={rateInput.newAnnualRate}
                            onChange={(newAnnualRate) => setRateInput((current) => ({ ...current, newAnnualRate }))}
                            min={RATE_MIN}
                            max={RATE_MAX}
                            step={RATE_STEP}
                            suffix="%"
                            decimals={3}
                            ariaLabel="调整后年利率"
                          />
                        </Field>
                      )}
                    </div>
                    {projectedRateResult.error || !projectedRateResult.result ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
                        {projectedRateResult.error}
                      </div>
                    ) : (
                      <>
                        <MultiCompareTable
                          columns={[
                            { title: '当前方案' },
                            {
                              title: '利率调整',
                              subtitle: form.loanType === 'combined'
                                ? `${rateInput.effectiveDate} · 商 ${formatRate(rateInput.newCommercialRate ?? form.commercialRate)} / 公 ${formatRate(rateInput.newFundRate ?? form.fundRate)}`
                                : describeRate(rateInput.effectiveDate, rateInput.newAnnualRate),
                            },
                            { title: '差额' },
                          ]}
                          rows={rateCompareRows}
                        />
                      </>
                    )}
                  </div>
                ) : null}

                {activeTab === 'compare' ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <Scale size={20} className="text-blue-700 dark:text-blue-300" aria-hidden />
                      <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">方案对比</h2>
                      <span className="text-xs text-slate-500 dark:text-slate-400">从当前期看四种方案差异</span>
                    </div>
                    <MultiCompareTable
                      columns={[
                        {
                          title: '当前方案',
                          subtitle: currentPaymentItem ? `自 ${currentPaymentItem.date} 起` : '保持现状',
                        },
                        {
                          title: '提前还款 · 减少年限',
                          subtitle: prepaySubtitle,
                          error: prepayComparison.result?.reduceTermError,
                        },
                        {
                          title: '提前还款 · 减少月供',
                          subtitle: prepaySubtitle,
                          error: prepayComparison.result?.reducePaymentError,
                        },
                        {
                          title: '利率调整',
                          subtitle: form.loanType === 'combined'
                            ? `${rateInput.effectiveDate} · 商 ${formatRate(rateInput.newCommercialRate ?? form.commercialRate)} / 公 ${formatRate(rateInput.newFundRate ?? form.fundRate)}`
                            : describeRate(rateInput.effectiveDate, rateInput.newAnnualRate),
                          error: projectedRateResult.error,
                        },
                      ]}
                      rows={[
                        {
                          label: '月供',
                          values: [
                            formatMoney(remainingFromCurrent?.monthlyPayment || 0),
                            prepayComparison.result?.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedMonthlyPayment) : undefined,
                            prepayComparison.result?.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedMonthlyPayment) : undefined,
                            projectedRateResult.result ? formatMoney(projectedRateResult.result.compare.newMonthlyPayment) : undefined,
                          ],
                        },
                        ...(form.loanType === 'combined'
                          ? ratePartCompares.map((item) => ({
                            label: `${formatLoanPart(item.part)}月供`,
                            values: [
                              formatMoney(item.oldMonthlyPayment),
                              undefined,
                              undefined,
                              formatMoney(item.newMonthlyPayment),
                            ],
                          }))
                          : []),
                        {
                          label: '剩余利息',
                          values: [
                            formatMoney(remainingFromCurrent?.remainingInterest || 0),
                            prepayComparison.result?.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingInterest) : undefined,
                            prepayComparison.result?.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingInterest) : undefined,
                            projectedRateResult.result ? formatMoney(projectedRateResult.result.compare.newRemainingInterest) : undefined,
                          ],
                        },
                        ...(form.loanType === 'combined'
                          ? ratePartCompares.map((item) => ({
                            label: `${formatLoanPart(item.part)}剩余利息`,
                            values: [
                              formatMoney(item.oldRemainingInterest),
                              undefined,
                              undefined,
                              formatMoney(item.newRemainingInterest),
                            ],
                          }))
                          : []),
                        {
                          label: '剩余期数',
                          values: [
                            `${remainingFromCurrent?.remainingPeriods || 0} 期`,
                            prepayComparison.result?.reduceTerm ? `${prepayComparison.result.reduceTerm.compare.adjustedRemainingPeriods} 期` : undefined,
                            prepayComparison.result?.reducePayment ? `${prepayComparison.result.reducePayment.compare.adjustedRemainingPeriods} 期` : undefined,
                            projectedRateResult.result ? `${remainingFromCurrent?.remainingPeriods || 0} 期` : undefined,
                          ],
                        },
                        {
                          label: '还清日期',
                          values: [
                            remainingFromCurrent?.endDate || '-',
                            prepayComparison.result?.reduceTerm?.compare.adjustedEndDate,
                            prepayComparison.result?.reducePayment?.compare.adjustedEndDate,
                            projectedRateResult.result?.compare.newEndDate,
                          ],
                        },
                        {
                          label: '节省利息',
                          values: [
                            '-',
                            prepayComparison.result?.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.savedInterest) : undefined,
                            prepayComparison.result?.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.savedInterest) : undefined,
                            projectedRateResult.result ? formatMoney(-projectedRateResult.result.compare.interestDiff) : undefined,
                          ],
                        },
                      ]}
                    />
                  </div>
                ) : null}

                {activeTab === 'budget' ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <Calculator size={20} className="text-blue-700 dark:text-blue-300" aria-hidden />
                      <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">预算反推</h2>
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="可承受月供（元）">
                        <input
                          className={baseInputClass}
                          type="number"
                          min="0"
                          value={budgetInput.affordableMonthlyPayment}
                          onChange={(event) =>
                            setBudgetInput((current) => ({ ...current, affordableMonthlyPayment: Number(event.target.value) }))
                          }
                        />
                      </Field>
                      <Field label="贷款年限">
                        <Slider
                          value={budgetInput.years}
                          onChange={(years) => setBudgetInput((current) => ({ ...current, years }))}
                          min={YEAR_MIN}
                          max={YEAR_MAX}
                          step={1}
                          suffix=" 年"
                          ariaLabel="预算反推年限"
                        />
                      </Field>
                      <Field label="年利率（%）">
                        <Slider
                          value={budgetInput.annualRate}
                          onChange={(annualRate) => setBudgetInput((current) => ({ ...current, annualRate }))}
                          min={RATE_MIN}
                          max={RATE_MAX}
                          step={RATE_STEP}
                          suffix="%"
                          decimals={3}
                          ariaLabel="预算反推年利率"
                        />
                      </Field>
                      <Field label="首付比例（%）">
                        <input
                          className={baseInputClass}
                          type="number"
                          min="0"
                          max="99"
                          value={budgetInput.downPaymentRatio}
                          onChange={(event) =>
                            setBudgetInput((current) => ({ ...current, downPaymentRatio: Number(event.target.value) }))
                          }
                        />
                      </Field>
                    </div>
                    {budgetResult.error || !budgetResult.result ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
                        {budgetResult.error}
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <StatCard title="可贷款金额" value={formatMoney(budgetResult.result.loanAmount, { unit: 'wan' })} icon={WalletCards} />
                        <StatCard title="预计总房价" value={formatMoney(budgetResult.result.totalHousePrice, { unit: 'wan' })} icon={Landmark} />
                        <StatCard title="预计首付" value={formatMoney(budgetResult.result.downPaymentAmount, { unit: 'wan' })} icon={PiggyBank} />
                        <StatCard title="预计总利息" value={formatMoney(budgetResult.result.totalInterest, { unit: 'wan' })} icon={LineChart} />
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
          </div>
        </div>

        <footer className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          计算结果仅供参考。实际月供、提前还款规则、扣款日期、违约金和利率调整方式，请以贷款银行最终确认为准。
        </footer>
      </div>
    </main>
  );
}

export default App;
