import { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CalendarDays,
  Calculator,
  Landmark,
  LineChart,
  PiggyBank,
  Scale,
  WalletCards,
} from 'lucide-react';
import {
  calculateBudgetReverse,
  buildRateSegmentSummary,
  calculateHistoricalLoanPlan,
  calculateMortgagePlan,
  calculatePrepaymentComparison,
  calculatePrepaymentPlan,
  calculateRateAdjustedPlan,
  formatMoney,
} from './core/mortgageCalculator';
import type { HistoricalLoanEvent, LoanInput, LoanType, PrepaymentMode, RepaymentMethod } from './types/mortgage';
import { formatDate, getNextMonthFirstDay } from './utils/date';
import { wanToYuan } from './utils/money';
import { loadStoredValue, removeStoredValue, saveStoredValue } from './utils/persistence';
import type { PaymentScheduleItem } from './types/mortgage';

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

const yearOptions = [5, 10, 15, 20, 25, 30];
const quickRateOptions = [5.145, 4.995, 4.795, 4.2, 3.95, 3.85, 3.5];
const STORAGE_PREFIX = 'mortgage-advisor:v1';

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
  mode: 'reduceTerm' as PrepaymentMode,
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

function inputClass() {
  return 'h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
}

function formatRate(rate: number | undefined): string {
  return Number.isFinite(rate) ? `${rate}%` : '-';
}

function getCurrentPaymentItem(schedule: PaymentScheduleItem[]): PaymentScheduleItem | undefined {
  const today = formatDate(new Date());
  return schedule.find((item) => item.date >= today) || schedule[schedule.length - 1];
}

function labelClass() {
  return 'mb-1.5 block text-sm font-medium text-slate-700';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <span className={labelClass()}>{label}</span>
      {children}
    </label>
  );
}

function SegmentedButton<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="grid rounded-lg border border-slate-200 bg-slate-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`min-h-10 rounded-md px-3 text-sm font-medium transition ${
            value === option.value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {option.label}
        </button>
      ))}
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
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{title}</p>
          <p className="money-figures mt-2 text-2xl font-semibold text-slate-950">{value}</p>
          {desc ? <p className="mt-2 text-sm text-slate-500">{desc}</p> : null}
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
          <Icon size={20} aria-hidden />
        </span>
      </div>
    </div>
  );
}

function CompareTable({ rows }: { rows: Array<{ label: string; old: string; next: string; diff: string }> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-[680px] w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-3 text-left font-medium">指标</th>
            <th className="px-4 py-3 text-right font-medium">当前方案</th>
            <th className="px-4 py-3 text-right font-medium">调整后</th>
            <th className="px-4 py-3 text-right font-medium">差额</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-slate-200">
              <td className="px-4 py-3 text-slate-700">{row.label}</td>
              <td className="money-figures px-4 py-3 text-right">{row.old}</td>
              <td className="money-figures px-4 py-3 text-right">{row.next}</td>
              <td className="money-figures px-4 py-3 text-right text-slate-700">{row.diff}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [form, setForm] = useState(() => loadStoredValue(`${STORAGE_PREFIX}:form`, defaultForm));
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [prepayInput, setPrepayInput] = useState<{
    date: string;
    amountWan: number;
    mode: PrepaymentMode;
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

  const prepayResult = useMemo(() => {
    if (!planResult.plan) return { result: null, error: planResult.error };
    try {
      return {
        result: calculatePrepaymentPlan(planResult.plan, {
          date: prepayInput.date,
          amount: wanToYuan(prepayInput.amountWan),
          mode: prepayInput.mode,
          includeCurrentMonthPayment: prepayInput.includeCurrentMonthPayment,
          penaltyFee: prepayInput.penaltyFee,
        }),
        error: '',
      };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '提前还款计算失败' };
    }
  }, [planResult, prepayInput]);

  const rateResult = useMemo(() => {
    if (!planResult.plan) return { result: null, error: planResult.error };
    try {
      return {
        result: calculateRateAdjustedPlan(planResult.plan, {
          effectiveDate: rateInput.effectiveDate,
          newAnnualRate: rateInput.newAnnualRate,
        }),
        error: '',
      };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '利率调整计算失败' };
    }
  }, [planResult, rateInput]);

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
  const actualPlan = historyEvents.length > 0 && historyResult.result ? historyResult.result.adjustedPlan : plan;
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
        ? { id: `rate-${Date.now()}`, type, date: form.firstPaymentDate, annualRate: form.annualRate }
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

  return (
    <main className="min-h-dvh bg-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-normal text-blue-700">MortgageAdvisor</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950 sm:text-4xl">房贷参谋</h1>
            <p className="mt-2 max-w-2xl text-base leading-7 text-slate-600">算清房贷，帮你做更好的还款决策。</p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            所有计算在本地浏览器完成
          </div>
        </header>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>已开启本地缓存，刷新页面后会自动恢复当前输入。</span>
          <button type="button" className="min-h-10 rounded-md border border-slate-300 px-3 font-medium text-slate-700 hover:bg-slate-100" onClick={resetAllInputs}>
            清空缓存并恢复默认
          </button>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel md:p-5">
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <span className={labelClass()}>贷款类型</span>
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
              <span className={labelClass()}>还款方式</span>
              <SegmentedButton
                value={form.repaymentMethod}
                onChange={(repaymentMethod) => updateForm({ repaymentMethod })}
                options={[
                  { value: 'equalPayment', label: '等额本息' },
                  { value: 'equalPrincipal', label: '等额本金' },
                ]}
              />
            </div>
            <div className="lg:col-span-4">
              <Field label="首次还款日期">
                <input className={inputClass()} type="date" value={form.firstPaymentDate} onChange={(event) => updateForm({ firstPaymentDate: event.target.value })} />
              </Field>
            </div>
          </div>

          {form.loanType === 'combined' ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h2 className="mb-4 text-base font-semibold text-slate-900">商业贷款</h2>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="金额（万元）">
                    <input className={inputClass()} type="number" min="0" value={form.commercialAmountWan} onChange={(event) => updateForm({ commercialAmountWan: Number(event.target.value) })} />
                  </Field>
                  <Field label="年限">
                    <select className={inputClass()} value={form.commercialYears} onChange={(event) => updateForm({ commercialYears: Number(event.target.value) })}>
                      {yearOptions.map((year) => <option key={year} value={year}>{year} 年</option>)}
                    </select>
                  </Field>
                  <Field label="年利率（%）">
                    <input className={inputClass()} type="number" inputMode="decimal" min="0" step="0.001" value={form.commercialRate} onChange={(event) => updateForm({ commercialRate: Number(event.target.value) })} />
                  </Field>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h2 className="mb-4 text-base font-semibold text-slate-900">公积金贷款</h2>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="金额（万元）">
                    <input className={inputClass()} type="number" min="0" value={form.fundAmountWan} onChange={(event) => updateForm({ fundAmountWan: Number(event.target.value) })} />
                  </Field>
                  <Field label="年限">
                    <select className={inputClass()} value={form.fundYears} onChange={(event) => updateForm({ fundYears: Number(event.target.value) })}>
                      {yearOptions.map((year) => <option key={year} value={year}>{year} 年</option>)}
                    </select>
                  </Field>
                  <Field label="年利率（%）">
                    <input className={inputClass()} type="number" inputMode="decimal" min="0" step="0.001" value={form.fundRate} onChange={(event) => updateForm({ fundRate: Number(event.target.value) })} />
                  </Field>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <Field label="贷款金额（万元）">
                <input className={inputClass()} type="number" min="0" value={form.amountWan} onChange={(event) => updateForm({ amountWan: Number(event.target.value) })} />
              </Field>
              <Field label="贷款年限">
                <select className={inputClass()} value={form.years} onChange={(event) => updateForm({ years: Number(event.target.value) })}>
                  {yearOptions.map((year) => <option key={year} value={year}>{year} 年</option>)}
                </select>
              </Field>
              <Field label="年利率（%）">
                <input className={inputClass()} type="number" inputMode="decimal" min="0" step="0.001" value={form.annualRate} onChange={(event) => updateForm({ annualRate: Number(event.target.value) })} />
              </Field>
            </div>
          )}
        </section>

        {planResult.error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert">{planResult.error}</div>
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
              <StatCard title="总利息" value={formatMoney(displayPlan?.summary.totalInterest || 0, { unit: 'wan' })} desc="完整周期" icon={LineChart} />
              <StatCard title="总还款" value={formatMoney(displayPlan?.summary.totalPayment || 0, { unit: 'wan' })} desc="本金 + 利息" icon={Banknote} />
              <StatCard title="还清日期" value={displayPlan?.summary.endDate || '-'} desc={`${displayPlan?.summary.totalPeriods || 0} 期`} icon={CalendarDays} />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-sm">
              {form.repaymentMethod === 'equalPrincipal'
                ? `当前方案下，首月月供约为 ${formatMoney(displayPlan?.summary.firstMonthPayment || 0)}，此后每月递减约 ${formatMoney(displayPlan?.summary.monthlyDecrease || 0)}，总利息约为 ${formatMoney(displayPlan?.summary.totalInterest || 0)}。`
                : `当前方案下，月供约为 ${formatMoney(displayPlan?.summary.monthlyPayment || 0)}，总利息约为 ${formatMoney(displayPlan?.summary.totalInterest || 0)}，预计将在 ${displayPlan?.summary.endDate || '-'} 还清。`}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-panel">
              <div className="flex gap-2 overflow-x-auto border-b border-slate-200 p-3">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`min-h-11 shrink-0 rounded-md px-4 text-sm font-medium transition ${
                      activeTab === tab.key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
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
                    <div className="flex items-center gap-2">
                      <Landmark size={20} className="text-blue-700" aria-hidden />
                      <h2 className="text-lg font-semibold text-slate-950">真实还款明细</h2>
                    </div>
                    {historyResult.error && historyEvents.length > 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert">{historyResult.error}</div>
                    ) : null}
                    <div className="rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                      {historyEvents.length > 0 ? '以下明细已纳入历史利率变化、已发生提前还款和违约金。' : '当前暂无历史变动，以下明细按基础贷款参数生成。'}
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="min-w-[960px] w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
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
                            <tr key={`${segment.startDate}-${segment.annualRate}`} className="border-t border-slate-200">
                              <td className="px-4 py-3">{segment.startDate} 至 {segment.endDate}</td>
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
                    <h3 className="text-base font-semibold text-slate-950">年度汇总</h3>
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      {actualAnnualSummary.map((year) => (
                        <div key={year.year} className="border-b border-slate-200 last:border-b-0">
                          <button
                            type="button"
                            className="grid min-h-14 w-full grid-cols-2 gap-3 bg-white px-4 py-3 text-left transition hover:bg-slate-50 md:grid-cols-5"
                            onClick={() => setExpandedYear(expandedYear === year.year ? null : year.year)}
                            aria-expanded={expandedYear === year.year}
                          >
                            <span className="font-medium text-slate-950">{year.year} 年</span>
                            <span className="money-figures text-sm text-slate-600">还款 {formatMoney(year.totalPayment)}</span>
                            <span className="money-figures text-sm text-slate-600">本金 {formatMoney(year.totalPrincipal)}</span>
                            <span className="money-figures text-sm text-slate-600">利息 {formatMoney(year.totalInterest)}</span>
                            <span className="money-figures text-sm text-slate-600">剩余 {formatMoney(year.endRemainingPrincipal)}</span>
                          </button>
                          {expandedYear === year.year ? (
                            <div className="overflow-x-auto bg-slate-50 p-3">
                              <table className="min-w-[980px] w-full text-sm">
                                <thead className="text-slate-500">
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
                                    <tr key={month.period} className="border-t border-slate-200 bg-white">
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
                  <div className="space-y-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-2">
                        <CalendarDays size={20} className="text-blue-700" aria-hidden />
                        <h2 className="text-lg font-semibold text-slate-950">历史变动</h2>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="min-h-10 rounded-md bg-blue-700 px-3 text-sm font-medium text-white hover:bg-blue-800" onClick={() => addHistoryEvent('rateChange')}>添加利率变化</button>
                        <button type="button" className="min-h-10 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800" onClick={() => addHistoryEvent('prepayment')}>添加提前还款</button>
                      </div>
                    </div>

                    {form.loanType === 'combined' ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                        组合贷历史变动需要分别指定还商贷还是公积金贷，当前版本先支持商贷/公积金单贷。
                      </div>
                    ) : null}
                    {historyEvents.length === 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                        暂无历史变动。添加利率变化或已发生提前还款后，完整影响会统一体现在“还款明细”里。
                      </div>
                    ) : null}

                    <div className="space-y-3">
                      {historyEvents.map((event) => (
                        <div key={event.id} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-12 md:items-end">
                          <div className="md:col-span-2">
                            <span className={labelClass()}>事件</span>
                            <div className="flex h-11 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
                              {event.type === 'rateChange' ? '利率变化' : '提前还款'}
                            </div>
                          </div>
                          <div className="md:col-span-2">
                            <Field label="生效/还款日期">
                              <input className={inputClass()} type="date" value={event.date} onChange={(changeEvent) => updateHistoryEvent(event.id, { date: changeEvent.target.value })} />
                            </Field>
                          </div>
                          {event.type === 'rateChange' ? (
                            <div className="md:col-span-5">
                              <Field label="新年利率（%）">
                                <input className={inputClass()} type="number" inputMode="decimal" min="0" step="0.001" value={event.annualRate} onChange={(changeEvent) => updateHistoryEvent(event.id, { annualRate: Number(changeEvent.target.value) } as Partial<HistoricalLoanEvent>)} />
                              </Field>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {quickRateOptions.map((rate) => (
                                  <button
                                    key={rate}
                                    type="button"
                                    className="min-h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                                    onClick={() => updateHistoryEvent(event.id, { annualRate: rate } as Partial<HistoricalLoanEvent>)}
                                  >
                                    {rate}%
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="md:col-span-2">
                                <Field label="提前还款（万元）">
                                  <input className={inputClass()} type="number" min="0" value={event.amount / 10000} onChange={(changeEvent) => updateHistoryEvent(event.id, { amount: wanToYuan(Number(changeEvent.target.value)) } as Partial<HistoricalLoanEvent>)} />
                                </Field>
                              </div>
                              <div className="md:col-span-2">
                                <Field label="处理方式">
                                  <select className={inputClass()} value={event.mode} onChange={(changeEvent) => updateHistoryEvent(event.id, { mode: changeEvent.target.value as PrepaymentMode } as Partial<HistoricalLoanEvent>)}>
                                    <option value="reduceTerm">减少年限</option>
                                    <option value="reducePayment">减少月供</option>
                                  </select>
                                </Field>
                              </div>
                              <div className="md:col-span-2">
                                <Field label="违约金（元）">
                                  <input className={inputClass()} type="number" min="0" value={event.penaltyFee || 0} onChange={(changeEvent) => updateHistoryEvent(event.id, { penaltyFee: Number(changeEvent.target.value) } as Partial<HistoricalLoanEvent>)} />
                                </Field>
                              </div>
                            </>
                          )}
                          <button type="button" className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 md:col-span-1" onClick={() => removeHistoryEvent(event.id)}>
                            删除
                          </button>
                        </div>
                      ))}
                    </div>

                    {historyResult.error || !historyResult.result ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert">{historyResult.error}</div>
                    ) : (
                      <div className="rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                        已记录 {historyEvents.length} 条历史变动。利率变化会在当月月供前生效，提前还款会在当月正常月供后扣减本金，违约金只计入现金支出、不抵扣本金；完整分段和月度明细请查看“还款明细”。
                      </div>
                    )}
                  </div>
                ) : null}

                {activeTab === 'prepay' ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <PiggyBank size={20} className="text-blue-700" aria-hidden />
                      <h2 className="text-lg font-semibold text-slate-950">提前还款测算</h2>
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="提前还款日期">
                        <input className={inputClass()} type="date" value={prepayInput.date} onChange={(event) => setPrepayInput((current) => ({ ...current, date: event.target.value }))} />
                      </Field>
                      <Field label="金额（万元）">
                        <input className={inputClass()} type="number" min="0" value={prepayInput.amountWan} onChange={(event) => setPrepayInput((current) => ({ ...current, amountWan: Number(event.target.value) }))} />
                      </Field>
                      <Field label="当月月供">
                        <select className={inputClass()} value={String(prepayInput.includeCurrentMonthPayment)} onChange={(event) => setPrepayInput((current) => ({ ...current, includeCurrentMonthPayment: event.target.value === 'true' }))}>
                          <option value="true">正常偿还</option>
                          <option value="false">提前还前不还</option>
                        </select>
                      </Field>
                      <Field label="手续费（元）">
                        <input className={inputClass()} type="number" min="0" value={prepayInput.penaltyFee} onChange={(event) => setPrepayInput((current) => ({ ...current, penaltyFee: Number(event.target.value) }))} />
                      </Field>
                    </div>
                    {prepayComparison.error || !prepayComparison.result ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert">{prepayComparison.error}</div>
                    ) : (
                      <div className="grid gap-5 xl:grid-cols-2">
                        {prepayComparison.result.reduceTerm ? (
                          <div className="space-y-4 rounded-lg border border-slate-200 p-4">
                            <h3 className="font-semibold text-slate-950">减少年限</h3>
                            <p className="text-sm leading-6 text-slate-600">月供尽量保持不变，优先缩短还款周期。</p>
                            <CompareTable rows={[
                              { label: '剩余本金', old: formatMoney(prepayComparison.result.reduceTerm.compare.originalRemainingPrincipal), next: formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingPrincipal), diff: formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingPrincipal - prepayComparison.result.reduceTerm.compare.originalRemainingPrincipal) },
                              { label: '月供', old: formatMoney(prepayComparison.result.reduceTerm.compare.originalMonthlyPayment), next: formatMoney(prepayComparison.result.reduceTerm.compare.adjustedMonthlyPayment), diff: formatMoney(prepayComparison.result.reduceTerm.compare.adjustedMonthlyPayment - prepayComparison.result.reduceTerm.compare.originalMonthlyPayment) },
                              { label: '剩余期数', old: `${prepayComparison.result.reduceTerm.compare.originalRemainingPeriods} 期`, next: `${prepayComparison.result.reduceTerm.compare.adjustedRemainingPeriods} 期`, diff: `${prepayComparison.result.reduceTerm.compare.adjustedRemainingPeriods - prepayComparison.result.reduceTerm.compare.originalRemainingPeriods} 期` },
                              { label: '剩余利息', old: formatMoney(prepayComparison.result.reduceTerm.compare.originalRemainingInterest), next: formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingInterest), diff: formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingInterest - prepayComparison.result.reduceTerm.compare.originalRemainingInterest) },
                              { label: '节省利息', old: '-', next: formatMoney(prepayComparison.result.reduceTerm.compare.savedInterest), diff: '-' },
                              { label: '还清日期', old: prepayComparison.result.reduceTerm.compare.originalEndDate, next: prepayComparison.result.reduceTerm.compare.adjustedEndDate, diff: '-' },
                            ]} />
                          </div>
                        ) : (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{prepayComparison.result.reduceTermError}</div>
                        )}
                        {prepayComparison.result.reducePayment ? (
                          <div className="space-y-4 rounded-lg border border-slate-200 p-4">
                            <h3 className="font-semibold text-slate-950">减少月供</h3>
                            <p className="text-sm leading-6 text-slate-600">剩余期限保持不变，优先降低每月现金流压力。</p>
                            <CompareTable rows={[
                              { label: '剩余本金', old: formatMoney(prepayComparison.result.reducePayment.compare.originalRemainingPrincipal), next: formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingPrincipal), diff: formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingPrincipal - prepayComparison.result.reducePayment.compare.originalRemainingPrincipal) },
                              { label: '月供', old: formatMoney(prepayComparison.result.reducePayment.compare.originalMonthlyPayment), next: formatMoney(prepayComparison.result.reducePayment.compare.adjustedMonthlyPayment), diff: formatMoney(prepayComparison.result.reducePayment.compare.adjustedMonthlyPayment - prepayComparison.result.reducePayment.compare.originalMonthlyPayment) },
                              { label: '剩余期数', old: `${prepayComparison.result.reducePayment.compare.originalRemainingPeriods} 期`, next: `${prepayComparison.result.reducePayment.compare.adjustedRemainingPeriods} 期`, diff: `${prepayComparison.result.reducePayment.compare.adjustedRemainingPeriods - prepayComparison.result.reducePayment.compare.originalRemainingPeriods} 期` },
                              { label: '剩余利息', old: formatMoney(prepayComparison.result.reducePayment.compare.originalRemainingInterest), next: formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingInterest), diff: formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingInterest - prepayComparison.result.reducePayment.compare.originalRemainingInterest) },
                              { label: '节省利息', old: '-', next: formatMoney(prepayComparison.result.reducePayment.compare.savedInterest), diff: '-' },
                              { label: '还清日期', old: prepayComparison.result.reducePayment.compare.originalEndDate, next: prepayComparison.result.reducePayment.compare.adjustedEndDate, diff: '-' },
                            ]} />
                          </div>
                        ) : (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{prepayComparison.result.reducePaymentError}</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {activeTab === 'rate' ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <LineChart size={20} className="text-blue-700" aria-hidden />
                      <h2 className="text-lg font-semibold text-slate-950">利率调整测算</h2>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="生效日期">
                        <input className={inputClass()} type="date" value={rateInput.effectiveDate} onChange={(event) => setRateInput((current) => ({ ...current, effectiveDate: event.target.value }))} />
                      </Field>
                      <Field label="新年利率（%）">
                        <input className={inputClass()} type="number" inputMode="decimal" min="0" step="0.001" value={rateInput.newAnnualRate} onChange={(event) => setRateInput((current) => ({ ...current, newAnnualRate: Number(event.target.value) }))} />
                      </Field>
                      <div className="md:col-span-2">
                        <span className={labelClass()}>常用利率</span>
                        <div className="flex flex-wrap gap-2">
                          {quickRateOptions.map((rate) => (
                            <button
                              key={rate}
                              type="button"
                              className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                              onClick={() => setRateInput((current) => ({ ...current, newAnnualRate: rate }))}
                            >
                              {rate}%
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {projectedRateResult.error || !projectedRateResult.result ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert">{projectedRateResult.error}</div>
                    ) : (
                      <>
                        <div className="rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                          利率调整后，月供变化 {formatMoney(projectedRateResult.result.compare.monthlyPaymentDiff)}，剩余利息变化 {formatMoney(projectedRateResult.result.compare.interestDiff)}。
                        </div>
                        <CompareTable rows={[
                          { label: '月供', old: formatMoney(projectedRateResult.result.compare.oldMonthlyPayment), next: formatMoney(projectedRateResult.result.compare.newMonthlyPayment), diff: formatMoney(projectedRateResult.result.compare.monthlyPaymentDiff) },
                          { label: '剩余利息', old: formatMoney(projectedRateResult.result.compare.oldRemainingInterest), next: formatMoney(projectedRateResult.result.compare.newRemainingInterest), diff: formatMoney(projectedRateResult.result.compare.interestDiff) },
                          { label: '还清日期', old: projectedRateResult.result.compare.oldEndDate, next: projectedRateResult.result.compare.newEndDate, diff: '-' },
                        ]} />
                      </>
                    )}
                  </div>
                ) : null}

                {activeTab === 'compare' ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <Scale size={20} className="text-blue-700" aria-hidden />
                      <h2 className="text-lg font-semibold text-slate-950">方案对比</h2>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="min-w-[960px] w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">指标</th>
                            <th className="px-4 py-3 text-right font-medium">当前方案</th>
                            <th className="px-4 py-3 text-right font-medium">提前还款-减少年限</th>
                            <th className="px-4 py-3 text-right font-medium">提前还款-减少月供</th>
                            <th className="px-4 py-3 text-right font-medium">利率调整</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ['月供', formatMoney(actualPlan?.summary.monthlyPayment || 0), prepayComparison.result?.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedMonthlyPayment) : '-', prepayComparison.result?.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedMonthlyPayment) : '-', projectedRateResult.result ? formatMoney(projectedRateResult.result.compare.newMonthlyPayment) : '-'],
                            ['利息', formatMoney(actualPlan?.summary.totalInterest || 0), prepayComparison.result?.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.adjustedRemainingInterest) : '-', prepayComparison.result?.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.adjustedRemainingInterest) : '-', projectedRateResult.result ? formatMoney(projectedRateResult.result.compare.newRemainingInterest) : '-'],
                            ['期数', `${actualPlan?.summary.totalPeriods || 0} 期`, prepayComparison.result?.reduceTerm ? `${prepayComparison.result.reduceTerm.compare.adjustedRemainingPeriods} 期` : '-', prepayComparison.result?.reducePayment ? `${prepayComparison.result.reducePayment.compare.adjustedRemainingPeriods} 期` : '-', projectedRateResult.result ? `${actualPlan?.summary.totalPeriods || 0} 期` : '-'],
                            ['还清日期', actualPlan?.summary.endDate || '-', prepayComparison.result?.reduceTerm ? prepayComparison.result.reduceTerm.compare.adjustedEndDate : '-', prepayComparison.result?.reducePayment ? prepayComparison.result.reducePayment.compare.adjustedEndDate : '-', projectedRateResult.result ? projectedRateResult.result.compare.newEndDate : '-'],
                            ['节省利息', '-', prepayComparison.result?.reduceTerm ? formatMoney(prepayComparison.result.reduceTerm.compare.savedInterest) : '-', prepayComparison.result?.reducePayment ? formatMoney(prepayComparison.result.reducePayment.compare.savedInterest) : '-', projectedRateResult.result ? formatMoney(-projectedRateResult.result.compare.interestDiff) : '-'],
                          ].map((row) => (
                            <tr key={row[0]} className="border-t border-slate-200">
                              <td className="px-4 py-3 text-slate-700">{row[0]}</td>
                              <td className="money-figures px-4 py-3 text-right">{row[1]}</td>
                              <td className="money-figures px-4 py-3 text-right">{row[2]}</td>
                              <td className="money-figures px-4 py-3 text-right">{row[3]}</td>
                              <td className="money-figures px-4 py-3 text-right">{row[4]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {activeTab === 'budget' ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <Calculator size={20} className="text-blue-700" aria-hidden />
                      <h2 className="text-lg font-semibold text-slate-950">预算反推</h2>
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="可承受月供（元）">
                        <input className={inputClass()} type="number" min="0" value={budgetInput.affordableMonthlyPayment} onChange={(event) => setBudgetInput((current) => ({ ...current, affordableMonthlyPayment: Number(event.target.value) }))} />
                      </Field>
                      <Field label="贷款年限">
                        <select className={inputClass()} value={budgetInput.years} onChange={(event) => setBudgetInput((current) => ({ ...current, years: Number(event.target.value) }))}>
                          {yearOptions.map((year) => <option key={year} value={year}>{year} 年</option>)}
                        </select>
                      </Field>
                      <Field label="年利率（%）">
                        <input className={inputClass()} type="number" inputMode="decimal" min="0" step="0.001" value={budgetInput.annualRate} onChange={(event) => setBudgetInput((current) => ({ ...current, annualRate: Number(event.target.value) }))} />
                      </Field>
                      <Field label="首付比例（%）">
                        <input className={inputClass()} type="number" min="0" max="99" value={budgetInput.downPaymentRatio} onChange={(event) => setBudgetInput((current) => ({ ...current, downPaymentRatio: Number(event.target.value) }))} />
                      </Field>
                    </div>
                    {budgetResult.error || !budgetResult.result ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert">{budgetResult.error}</div>
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

        <footer className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
          计算结果仅供参考。实际月供、提前还款规则、扣款日期、违约金和利率调整方式，请以贷款银行最终确认为准。
        </footer>
      </div>
    </main>
  );
}

export default App;

