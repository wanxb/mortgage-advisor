import { useEffect, useMemo, useState } from 'react';
import {
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
import type { HistoricalLoanEvent, LoanInput, LoanType, PrepaymentMode, RepaymentMethod } from './types/mortgage';
import { formatDate, getNextMonthFirstDay } from './utils/date';
import { wanToYuan } from './utils/money';
import { loadStoredValue, removeStoredValue, saveStoredValue } from './utils/persistence';
import type { PaymentScheduleItem } from './types/mortgage';
import { InfoHint, Slider, Tooltip } from './components/ui';

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

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'schedule', label: '还款明细' },
  { key: 'history', label: '历史变动' },
  { key: 'prepay', label: '提前还款' },
  { key: 'rate', label: '利率调整' },
  { key: 'compare', label: '方案对比' },
  { key: 'budget', label: '预算反推' },
];

const yearPresets = [5, 10, 15, 20, 25, 30];
const quickRateOptions = [5.145, 4.995, 4.795, 4.2, 3.95, 3.85, 3.5, 3.1, 2.85];
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
  includeCurrentMonthPayment: true,
  penaltyFee: 0,
};

const defaultRateInput = {
  effectiveDate: defaultForm.firstPaymentDate,
  newAnnualRate: 3,
};

const defaultBudgetInput = {
  affordableMonthlyPayment: 4000,
  years: 30,
  annualRate: 3.5,
  downPaymentRatio: 30,
};

const defaultHistoryEvents: HistoricalLoanEvent[] = [];

function toLoanInput(form: LoanFormState): LoanInput {
  return {
    loanType: form.loanType,
    repaymentMethod: form.repaymentMethod,
    amount: wanToYuan(form.amountWan),
    years: form.years,
    annualRate: form.annualRate,
    firstPaymentDate: form.firstPaymentDate,
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

const dateInputClass = `${baseInputClass} pr-2 [color-scheme:light] dark:[color-scheme:dark]`;

function formatRate(rate: number | undefined): string {
  return Number.isFinite(rate) ? `${rate}%` : '-';
}

function getCurrentPaymentItem(schedule: PaymentScheduleItem[]): PaymentScheduleItem | undefined {
  const today = formatDate(new Date());
  return schedule.find((item) => item.date >= today) || schedule[schedule.length - 1];
}

const labelBase = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
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
}: {
  title: string;
  value: string;
  desc?: string;
  icon: typeof Calculator;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
          <p className="money-figures mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
          {desc ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{desc}</p> : null}
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
          <Icon size={20} aria-hidden />
        </span>
      </div>
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

function MultiCompareTable({ columns, rows }: { columns: CompareColumn[]; rows: CompareRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <tr>
            <th className="px-4 py-3 text-left font-medium">指标</th>
            {columns.map((column) => (
              <th key={column.title} className="px-4 py-3 text-right font-medium align-top">
                <div className="font-semibold text-slate-700 dark:text-slate-200">{column.title}</div>
                {column.subtitle ? (
                  <div className="mt-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">{column.subtitle}</div>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-slate-200 dark:border-slate-700">
              <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{row.label}</td>
              {row.values.map((value, index) => (
                <td key={index} className="money-figures px-4 py-3 text-right text-slate-700 dark:text-slate-200">
                  {value ?? '-'}
                </td>
              ))}
            </tr>
          ))}
          {columns.some((column) => column.error) ? (
            <tr className="border-t border-slate-200 dark:border-slate-700">
              <td className="px-4 py-3 text-slate-500 dark:text-slate-400">备注</td>
              {columns.map((column, index) => (
                <td key={index} className="px-4 py-3 text-right text-xs text-amber-700 dark:text-amber-400">
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
  return `${date} · 提前还 ${amountWan} 万`;
}

function describeRate(effectiveDate: string, rate: number): string {
  return `${effectiveDate} · 调整为 ${rate}%`;
}

function App() {
  const [form, setForm] = useState(() => loadStoredValue(`${STORAGE_PREFIX}:form`, defaultForm));
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [prepayInput, setPrepayInput] = useState<{
    date: string;
    amountWan: number;
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

  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:form`, form), [form]);
  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:prepay`, prepayInput), [prepayInput]);
  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:rate`, rateInput), [rateInput]);
  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:budget`, budgetInput), [budgetInput]);
  useEffect(() => saveStoredValue(`${STORAGE_PREFIX}:history`, historyEvents), [historyEvents]);

  const planResult = useMemo(() => {
    try {
      return { plan: calculateMortgagePlan(toLoanInput(form)), error: '' };
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : '计算失败' };
    }
  }, [form]);

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
      return { result: calculateHistoricalLoanPlan(toLoanInput(form), historyEvents), error: '' };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '历史变动计算失败' };
    }
  }, [form, historyEvents, planResult]);

  const plan = planResult.plan;
  const hasHistory = historyEvents.length > 0;
  const actualPlan = hasHistory && historyResult.result ? historyResult.result.adjustedPlan : plan;
  const displayPlan = actualPlan || plan;
  const currentPaymentItem = displayPlan ? getCurrentPaymentItem(displayPlan.schedule) : undefined;
  const rateSegments = actualPlan ? buildRateSegmentSummary(actualPlan.schedule) : [];
  const actualAnnualSummary = actualPlan?.annualSummary || [];

  const prepayComparison = useMemo(() => {
    if (!actualPlan) return { result: null, error: planResult.error };
    try {
      return {
        result: calculatePrepaymentComparison(actualPlan, {
          date: prepayInput.date,
          amount: wanToYuan(prepayInput.amountWan),
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
        }),
        error: '',
      };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '利率调整计算失败' };
    }
  }, [actualPlan, planResult.error, rateInput]);

  const updateForm = (patch: Partial<LoanFormState>) => setForm((current) => ({ ...current, ...patch }));
  const updateHistoryEvent = (id: string, patch: Partial<HistoricalLoanEvent>) => {
    setHistoryEvents((events) => events.map((event) => {
      if (event.id !== id) return event;
      return { ...event, ...patch } as HistoricalLoanEvent;
    }));
  };
  const addHistoryEvent = (type: HistoricalLoanEvent['type']) => {
    setHistoryEvents((events) => [
      ...events,
      type === 'rateChange'
        ? { id: `rate-${Date.now()}`, type, date: form.firstPaymentDate, annualRate: form.annualRate, penaltyFee: 0 }
        : { id: `prepay-${Date.now()}`, type, date: form.firstPaymentDate, amount: wanToYuan(10), mode: 'reduceTerm', penaltyFee: 0 },
    ]);
  };
  const removeHistoryEvent = (id: string) => setHistoryEvents((events) => events.filter((event) => event.id !== id));
  const resetAllInputs = () => {
    removeStoredValue(`${STORAGE_PREFIX}:form`);
    removeStoredValue(`${STORAGE_PREFIX}:prepay`);
    removeStoredValue(`${STORAGE_PREFIX}:rate`);
    removeStoredValue(`${STORAGE_PREFIX}:budget`);
    removeStoredValue(`${STORAGE_PREFIX}:history`);
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
    const remainingInterest = future.reduce((acc, item) => acc + item.interest, 0);
    return {
      monthlyPayment: currentPaymentItem.payment,
      remainingPeriods: future.length,
      remainingInterest,
      endDate: displayPlan.summary.endDate,
    };
  }, [displayPlan, currentPaymentItem]);

  return (
    <main className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">房贷参谋</h1>
            <p className="hidden text-sm text-slate-500 dark:text-slate-400 sm:block">算清房贷，帮你做更好的还款决策</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
              所有计算在本地浏览器完成
            </span>
            <Tooltip text="已开启本地缓存，刷新页面后会自动恢复当前输入。" position="bottom">
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={resetAllInputs}
              >
                <Trash2 size={14} aria-hidden /> 清空缓存并恢复默认
              </button>
            </Tooltip>
          </div>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-none md:p-5">
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-4">
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
            <div className="lg:col-span-4">
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
            <div className="lg:col-span-4">
              <Field label="首次还款日期">
                <input
                  className={dateInputClass}
                  type="date"
                  value={form.firstPaymentDate}
                  onChange={(event) => updateForm({ firstPaymentDate: event.target.value })}
                />
              </Field>
            </div>
          </div>

          {form.loanType === 'combined' ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">商业贷款</h2>
                <div className="grid gap-4">
                  <Field label="金额（万元）">
                    <input
                      className={baseInputClass}
                      type="number"
                      min="0"
                      value={form.commercialAmountWan}
                      onChange={(event) => updateForm({ commercialAmountWan: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label="贷款年限（年）">
                    <Slider
                      value={form.commercialYears}
                      onChange={(commercialYears) => updateForm({ commercialYears })}
                      min={YEAR_MIN}
                      max={YEAR_MAX}
                      step={1}
                      suffix=" 年"
                      presets={yearPresets}
                      ariaLabel="商贷年限"
                    />
                  </Field>
                  <Field label="年利率（%）">
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
                <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">公积金贷款</h2>
                <div className="grid gap-4">
                  <Field label="金额（万元）">
                    <input
                      className={baseInputClass}
                      type="number"
                      min="0"
                      value={form.fundAmountWan}
                      onChange={(event) => updateForm({ fundAmountWan: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label="贷款年限（年）">
                    <Slider
                      value={form.fundYears}
                      onChange={(fundYears) => updateForm({ fundYears })}
                      min={YEAR_MIN}
                      max={YEAR_MAX}
                      step={1}
                      suffix=" 年"
                      presets={yearPresets}
                      ariaLabel="公积金贷年限"
                    />
                  </Field>
                  <Field label="年利率（%）">
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
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <Field label="贷款金额（万元）">
                <input
                  className={baseInputClass}
                  type="number"
                  min="0"
                  value={form.amountWan}
                  onChange={(event) => updateForm({ amountWan: Number(event.target.value) })}
                />
              </Field>
              <Field label="贷款年限（年）">
                <Slider
                  value={form.years}
                  onChange={(years) => updateForm({ years })}
                  min={YEAR_MIN}
                  max={YEAR_MAX}
                  step={1}
                  suffix=" 年"
                  presets={yearPresets}
                  ariaLabel="贷款年限"
                />
              </Field>
              <Field label="年利率（%）">
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

        {planResult.error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
            {planResult.error}
          </div>
        ) : null}

        {plan ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="当前月供"
                value={formatMoney(currentPaymentItem?.payment || displayPlan?.summary.monthlyPayment || 0)}
                desc={currentPaymentItem ? `${currentPaymentItem.date}，利率 ${formatRate(currentPaymentItem.annualRate)}` : '按当前真实计划'}
                icon={WalletCards}
              />
              <StatCard
                title="总利息"
                value={formatMoney(displayPlan?.summary.totalInterest || 0, { unit: 'wan' })}
                desc="完整周期"
                icon={LineChart}
              />
              <StatCard
                title="总还款"
                value={formatMoney(displayPlan?.summary.totalPayment || 0, { unit: 'wan' })}
                desc="本金 + 利息"
                icon={Banknote}
              />
              <StatCard
                title="还清日期"
                value={displayPlan?.summary.endDate || '-'}
                desc={`${displayPlan?.summary.totalPeriods || 0} 期`}
                icon={CalendarDays}
              />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
              <div className="flex gap-2 overflow-x-auto border-b border-slate-200 p-3 dark:border-slate-700">
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
                      <>
                        <div className="flex items-center gap-2">
                          <Landmark size={20} className="text-blue-700 dark:text-blue-300" aria-hidden />
                          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">真实还款明细</h2>
                          <span className="text-xs text-slate-500 dark:text-slate-400">以下明细已纳入历史利率变化、已发生提前还款和违约金。</span>
                        </div>
                        {historyResult.error ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
                            {historyResult.error}
                          </div>
                        ) : null}
                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                          <table className="min-w-[960px] w-full text-sm">
                            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              <tr>
                                <th className="px-4 py-3 text-left font-medium">利率阶段</th>
                                <th className="px-4 py-3 text-right font-medium">利率</th>
                                <th className="px-4 py-3 text-right font-medium">期数</th>
                                <th className="px-4 py-3 text-right font-medium">还款额</th>
                                <th className="px-4 py-3 text-right font-medium">本金</th>
                                <th className="px-4 py-3 text-right font-medium">利息</th>
                                <th className="px-4 py-3 text-right font-medium">提前还本</th>
                                <th className="px-4 py-3 text-right font-medium">违约金</th>
                                <th className="px-4 py-3 text-right font-medium">段末剩余</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rateSegments.map((segment) => (
                                <tr key={`${segment.startDate}-${segment.annualRate}`} className="border-t border-slate-200 dark:border-slate-700">
                                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                                    {segment.startDate} 至 {segment.endDate}
                                  </td>
                                  <td className="money-figures px-4 py-3 text-right">{formatRate(segment.annualRate)}</td>
                                  <td className="money-figures px-4 py-3 text-right">{segment.periods} 期</td>
                                  <td className="money-figures px-4 py-3 text-right">{formatMoney(segment.totalPayment)}</td>
                                  <td className="money-figures px-4 py-3 text-right">{formatMoney(segment.totalPrincipal)}</td>
                                  <td className="money-figures px-4 py-3 text-right">{formatMoney(segment.totalInterest)}</td>
                                  <td className="money-figures px-4 py-3 text-right">{segment.totalExtraPrincipal ? formatMoney(segment.totalExtraPrincipal) : '-'}</td>
                                  <td className="money-figures px-4 py-3 text-right">{segment.totalPenaltyFee ? formatMoney(segment.totalPenaltyFee) : '-'}</td>
                                  <td className="money-figures px-4 py-3 text-right">{formatMoney(segment.endRemainingPrincipal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : null}
                    <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">年度汇总</h3>
                    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                      {actualAnnualSummary.map((year) => (
                        <div key={year.year} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
                          <button
                            type="button"
                            className="grid min-h-14 w-full grid-cols-2 gap-3 bg-white px-4 py-3 text-left transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 md:grid-cols-5"
                            onClick={() => setExpandedYear(expandedYear === year.year ? null : year.year)}
                            aria-expanded={expandedYear === year.year}
                          >
                            <span className="font-medium text-slate-950 dark:text-slate-50">{year.year} 年</span>
                            <span className="money-figures text-sm text-slate-600 dark:text-slate-300">还款 {formatMoney(year.totalPayment)}</span>
                            <span className="money-figures text-sm text-slate-600 dark:text-slate-300">本金 {formatMoney(year.totalPrincipal)}</span>
                            <span className="money-figures text-sm text-slate-600 dark:text-slate-300">利息 {formatMoney(year.totalInterest)}</span>
                            <span className="money-figures text-sm text-slate-600 dark:text-slate-300">剩余 {formatMoney(year.endRemainingPrincipal)}</span>
                          </button>
                          {expandedYear === year.year ? (
                            <div className="overflow-x-auto bg-slate-50 p-3 dark:bg-slate-800/40">
                              <table className="min-w-[980px] w-full text-sm">
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
                                      <td className="px-3 py-2">{month.date}</td>
                                      <td className="money-figures px-3 py-2 text-right">{formatRate(month.annualRate)}</td>
                                      <td className="money-figures px-3 py-2 text-right">{formatMoney(month.payment)}</td>
                                      <td className="money-figures px-3 py-2 text-right">{formatMoney(month.principal)}</td>
                                      <td className="money-figures px-3 py-2 text-right">{formatMoney(month.interest)}</td>
                                      <td className="money-figures px-3 py-2 text-right">{month.extraPrincipal ? formatMoney(month.extraPrincipal) : '-'}</td>
                                      <td className="money-figures px-3 py-2 text-right">{month.penaltyFee ? formatMoney(month.penaltyFee) : '-'}</td>
                                      <td className="money-figures px-3 py-2 text-right">{formatMoney(month.remainingPrincipal)}</td>
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
                ) : null}

                {activeTab === 'history' ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-2">
                        <CalendarDays size={20} className="text-blue-700 dark:text-blue-300" aria-hidden />
                        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">历史变动</h2>
                        <span className="text-xs text-slate-500 dark:text-slate-400">记录已发生的利率调整和提前还款</span>
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
                      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                        <table className="min-w-[860px] w-full text-sm">
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
                                    onChange={(changeEvent) => updateHistoryEvent(event.id, { date: changeEvent.target.value })}
                                  />
                                </td>
                                <td className="px-3 py-2 min-w-[280px]">
                                  {event.type === 'rateChange' ? (
                                    <Slider
                                      value={event.annualRate}
                                      onChange={(annualRate) => updateHistoryEvent(event.id, { annualRate } as Partial<HistoricalLoanEvent>)}
                                      min={RATE_MIN}
                                      max={RATE_MAX}
                                      step={RATE_STEP}
                                      suffix="%"
                                      decimals={3}
                                      presets={quickRateOptions}
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
                                    className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                                    onClick={() => removeHistoryEvent(event.id)}
                                  >
                                    <Trash2 size={14} aria-hidden /> 删除
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
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="提前还款日期">
                        <input
                          className={dateInputClass}
                          type="date"
                          value={prepayInput.date}
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
                            subtitle: '月供尽量不变 · 期限缩短',
                            error: prepayComparison.result.reduceTermError,
                          },
                          {
                            title: '减少月供',
                            subtitle: '期限不变 · 月供下降',
                            error: prepayComparison.result.reducePaymentError,
                          },
                        ]}
                        rows={[
                          {
                            label: '剩余本金',
                            values: [
                              formatMoney(prepayComparison.result.reduceTerm?.compare.originalRemainingPrincipal || prepayComparison.result.reducePayment?.compare.originalRemainingPrincipal || 0),
                              prepayComparison.result.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingPrincipal) : undefined,
                              prepayComparison.result.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingPrincipal) : undefined,
                            ],
                          },
                          {
                            label: '月供',
                            values: [
                              formatMoney(prepayComparison.result.reduceTerm?.compare.originalMonthlyPayment || prepayComparison.result.reducePayment?.compare.originalMonthlyPayment || 0),
                              prepayComparison.result.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedMonthlyPayment) : undefined,
                              prepayComparison.result.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedMonthlyPayment) : undefined,
                            ],
                          },
                          {
                            label: '剩余期数',
                            values: [
                              `${prepayComparison.result.reduceTerm?.compare.originalRemainingPeriods || prepayComparison.result.reducePayment?.compare.originalRemainingPeriods || 0} 期`,
                              prepayComparison.result.reduceTerm ? `${prepayComparison.result.reduceTerm.compare.adjustedRemainingPeriods} 期` : undefined,
                              prepayComparison.result.reducePayment ? `${prepayComparison.result.reducePayment.compare.adjustedRemainingPeriods} 期` : undefined,
                            ],
                          },
                          {
                            label: '剩余利息',
                            values: [
                              formatMoney(prepayComparison.result.reduceTerm?.compare.originalRemainingInterest || prepayComparison.result.reducePayment?.compare.originalRemainingInterest || 0),
                              prepayComparison.result.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingInterest) : undefined,
                              prepayComparison.result.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingInterest) : undefined,
                            ],
                          },
                          {
                            label: '节省利息',
                            values: [
                              '-',
                              prepayComparison.result.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.savedInterest) : undefined,
                              prepayComparison.result.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.savedInterest) : undefined,
                            ],
                          },
                          {
                            label: '还清日期',
                            values: [
                              prepayComparison.result.reduceTerm?.compare.originalEndDate || prepayComparison.result.reducePayment?.compare.originalEndDate || '-',
                              prepayComparison.result.reduceTerm?.compare.adjustedEndDate,
                              prepayComparison.result.reducePayment?.compare.adjustedEndDate,
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="生效日期">
                        <input
                          className={dateInputClass}
                          type="date"
                          value={rateInput.effectiveDate}
                          onChange={(event) => setRateInput((current) => ({ ...current, effectiveDate: event.target.value }))}
                        />
                      </Field>
                      <Field label="年利率（%）">
                        <Slider
                          value={rateInput.newAnnualRate}
                          onChange={(newAnnualRate) => setRateInput((current) => ({ ...current, newAnnualRate }))}
                          min={RATE_MIN}
                          max={RATE_MAX}
                          step={RATE_STEP}
                          suffix="%"
                          decimals={3}
                          presets={quickRateOptions}
                          ariaLabel="调整后年利率"
                        />
                      </Field>
                    </div>
                    {projectedRateResult.error || !projectedRateResult.result ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
                        {projectedRateResult.error}
                      </div>
                    ) : (
                      <>
                        <div className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                          利率调整后，月供变化 {formatMoney(projectedRateResult.result.compare.monthlyPaymentDiff)}，剩余利息变化 {formatMoney(projectedRateResult.result.compare.interestDiff)}。
                        </div>
                        <MultiCompareTable
                          columns={[
                            { title: '当前方案' },
                            { title: '利率调整', subtitle: describeRate(rateInput.effectiveDate, rateInput.newAnnualRate) },
                          ]}
                          rows={[
                            {
                              label: '月供',
                              values: [
                                formatMoney(projectedRateResult.result.compare.oldMonthlyPayment),
                                formatMoney(projectedRateResult.result.compare.newMonthlyPayment),
                              ],
                            },
                            {
                              label: '剩余利息',
                              values: [
                                formatMoney(projectedRateResult.result.compare.oldRemainingInterest),
                                formatMoney(projectedRateResult.result.compare.newRemainingInterest),
                              ],
                            },
                            {
                              label: '还清日期',
                              values: [
                                projectedRateResult.result.compare.oldEndDate,
                                projectedRateResult.result.compare.newEndDate,
                              ],
                            },
                          ]}
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
                          subtitle: describePrepay(prepayInput.date, prepayInput.amountWan),
                          error: prepayComparison.result?.reduceTermError,
                        },
                        {
                          title: '提前还款 · 减少月供',
                          subtitle: describePrepay(prepayInput.date, prepayInput.amountWan),
                          error: prepayComparison.result?.reducePaymentError,
                        },
                        {
                          title: '利率调整',
                          subtitle: describeRate(rateInput.effectiveDate, rateInput.newAnnualRate),
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
                        {
                          label: '剩余利息',
                          values: [
                            formatMoney(remainingFromCurrent?.remainingInterest || 0),
                            prepayComparison.result?.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingInterest) : undefined,
                            prepayComparison.result?.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingInterest) : undefined,
                            projectedRateResult.result ? formatMoney(projectedRateResult.result.compare.newRemainingInterest) : undefined,
                          ],
                        },
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
                          presets={yearPresets}
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

        <footer className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          计算结果仅供参考。实际月供、提前还款规则、扣款日期、违约金和利率调整方式，请以贷款银行最终确认为准。
        </footer>
      </div>
    </main>
  );
}

export default App;
