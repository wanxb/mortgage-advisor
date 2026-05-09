import React, { useMemo, useState } from 'react';

/**
 * 房贷计算器 React 单文件 Demo
 *
 * 修复说明：
 * 1. 已移除 lucide-react 外部依赖，避免沙箱环境尝试从 CDN 拉取图标导致构建失败。
 * 2. 改为本文件内置 Icon 组件，所有图标使用本地 SVG 渲染。
 * 3. 增加 runCalculatorSelfTests()，在开发环境中通过 console.assert 做基础计算自检。
 *
 * 使用方式：
 * 1. 放到 React / Vite / Next.js 项目中作为页面组件。
 * 2. 默认使用 Tailwind CSS。
 * 3. 当前文件内置核心计算逻辑，后续可拆分到 src/core/mortgageCalculator.ts。
 */

const tabs = [
  { key: 'schedule', label: '还款明细' },
  { key: 'prepay', label: '提前还款' },
  { key: 'rate', label: '利率调整' },
  { key: 'compare', label: '方案对比' },
  { key: 'budget', label: '预算反推' },
];

function Icon({ name, size = 20 }) {
  const commonProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  const paths = {
    calculator: (
      <>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <line x1="8" y1="6" x2="16" y2="6" />
        <line x1="8" y1="10" x2="8" y2="10" />
        <line x1="12" y1="10" x2="12" y2="10" />
        <line x1="16" y1="10" x2="16" y2="10" />
        <line x1="8" y1="14" x2="8" y2="14" />
        <line x1="12" y1="14" x2="12" y2="14" />
        <line x1="16" y1="14" x2="16" y2="18" />
        <line x1="8" y1="18" x2="12" y2="18" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
    card: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </>
    ),
    sheet: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h8" />
        <path d="M8 9h2" />
      </>
    ),
    percent: (
      <>
        <line x1="19" y1="5" x2="5" y2="19" />
        <circle cx="6.5" cy="6.5" r="2.5" />
        <circle cx="17.5" cy="17.5" r="2.5" />
      </>
    ),
    trend: (
      <>
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="14 7 21 7 21 14" />
      </>
    ),
  };

  return <svg {...commonProps}>{paths[name] || paths.calculator}</svg>;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function formatMoney(value, unit = 'yuan') {
  const v = Number(value || 0);
  if (unit === 'wan') return `${(v / 10000).toFixed(2)} 万`;
  return `${v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`;
}

function parseDate(date) {
  const [y, m, d] = String(date || '2026-01-01').split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonths(date, months) {
  const d = parseDate(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return formatDate(d);
}

function sameMonthOrAfter(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  return da.getFullYear() > db.getFullYear() || (da.getFullYear() === db.getFullYear() && da.getMonth() >= db.getMonth());
}

function sum(list) {
  return roundMoney(list.reduce((a, b) => a + Number(b || 0), 0));
}

function getMonthlyRate(annualRate) {
  return Number(annualRate || 0) / 100 / 12;
}

function buildEqualPaymentSchedule({ principal, annualRate, periods, firstPaymentDate }) {
  const monthlyRate = getMonthlyRate(annualRate);
  let monthlyPayment = monthlyRate === 0
    ? principal / periods
    : principal * monthlyRate * Math.pow(1 + monthlyRate, periods) / (Math.pow(1 + monthlyRate, periods) - 1);

  const schedule = [];
  let remainingPrincipal = principal;
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;

  for (let i = 1; i <= periods; i++) {
    const interest = remainingPrincipal * monthlyRate;
    let currentPrincipal = monthlyPayment - interest;

    if (i === periods || currentPrincipal > remainingPrincipal) {
      currentPrincipal = remainingPrincipal;
      monthlyPayment = currentPrincipal + interest;
    }

    remainingPrincipal = roundMoney(remainingPrincipal - currentPrincipal);
    totalPaidPrincipal = roundMoney(totalPaidPrincipal + currentPrincipal);
    totalPaidInterest = roundMoney(totalPaidInterest + interest);

    schedule.push({
      period: i,
      date: addMonths(firstPaymentDate, i - 1),
      payment: roundMoney(monthlyPayment),
      principal: roundMoney(currentPrincipal),
      interest: roundMoney(interest),
      remainingPrincipal: Math.max(0, roundMoney(remainingPrincipal)),
      totalPaidPrincipal,
      totalPaidInterest,
    });

    if (remainingPrincipal <= 0) break;
  }

  return schedule;
}

function buildEqualPrincipalSchedule({ principal, annualRate, periods, firstPaymentDate }) {
  const monthlyRate = getMonthlyRate(annualRate);
  const monthlyPrincipal = principal / periods;

  const schedule = [];
  let remainingPrincipal = principal;
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;

  for (let i = 1; i <= periods; i++) {
    const interest = remainingPrincipal * monthlyRate;
    let currentPrincipal = monthlyPrincipal;

    if (i === periods || currentPrincipal > remainingPrincipal) {
      currentPrincipal = remainingPrincipal;
    }

    const payment = currentPrincipal + interest;
    remainingPrincipal = roundMoney(remainingPrincipal - currentPrincipal);
    totalPaidPrincipal = roundMoney(totalPaidPrincipal + currentPrincipal);
    totalPaidInterest = roundMoney(totalPaidInterest + interest);

    schedule.push({
      period: i,
      date: addMonths(firstPaymentDate, i - 1),
      payment: roundMoney(payment),
      principal: roundMoney(currentPrincipal),
      interest: roundMoney(interest),
      remainingPrincipal: Math.max(0, roundMoney(remainingPrincipal)),
      totalPaidPrincipal,
      totalPaidInterest,
    });

    if (remainingPrincipal <= 0) break;
  }

  return schedule;
}

function buildAnnualSummary(schedule) {
  const map = new Map();
  schedule.forEach((item) => {
    const year = parseDate(item.date).getFullYear();
    if (!map.has(year)) map.set(year, []);
    map.get(year).push(item);
  });

  return Array.from(map.entries()).map(([year, months]) => ({
    year,
    totalPayment: sum(months.map((x) => x.payment)),
    totalPrincipal: sum(months.map((x) => x.principal)),
    totalInterest: sum(months.map((x) => x.interest)),
    endRemainingPrincipal: months[months.length - 1]?.remainingPrincipal || 0,
    months,
  }));
}

function buildPlan(input, schedule) {
  const totalPrincipal = input.loanType === 'combined'
    ? Number(input.commercialAmount || 0) + Number(input.fundAmount || 0)
    : Number(input.amount || 0);
  const totalInterest = sum(schedule.map((x) => x.interest));
  const first = schedule[0];
  const last = schedule[schedule.length - 1];

  return {
    input,
    schedule,
    annualSummary: buildAnnualSummary(schedule),
    summary: {
      totalPrincipal: roundMoney(totalPrincipal),
      totalInterest,
      totalPayment: roundMoney(totalPrincipal + totalInterest),
      monthlyPayment: first?.payment || 0,
      firstMonthPayment: first?.payment || 0,
      lastMonthPayment: last?.payment || 0,
      monthlyDecrease: input.repaymentMethod === 'equalPrincipal' && schedule.length > 1
        ? roundMoney(schedule[0].payment - schedule[1].payment)
        : 0,
      totalPeriods: schedule.length,
      endDate: last?.date || input.firstPaymentDate,
    },
  };
}

function calculateSinglePlan(input) {
  const principal = Number(input.amount || 0);
  const periods = Number(input.years || 0) * 12;
  if (!principal || !periods) return buildPlan(input, []);

  const schedule = input.repaymentMethod === 'equalPayment'
    ? buildEqualPaymentSchedule({ principal, annualRate: input.annualRate, periods, firstPaymentDate: input.firstPaymentDate })
    : buildEqualPrincipalSchedule({ principal, annualRate: input.annualRate, periods, firstPaymentDate: input.firstPaymentDate });

  return buildPlan(input, schedule);
}

function calculateMortgagePlan(input) {
  if (input.loanType !== 'combined') return calculateSinglePlan(input);

  const commercialInput = {
    ...input,
    loanType: 'commercial',
    amount: Number(input.commercialAmount || 0),
    years: Number(input.commercialYears || 0),
    annualRate: Number(input.commercialRate || 0),
  };

  const fundInput = {
    ...input,
    loanType: 'fund',
    amount: Number(input.fundAmount || 0),
    years: Number(input.fundYears || 0),
    annualRate: Number(input.fundRate || 0),
  };

  const commercialPlan = calculateSinglePlan(commercialInput);
  const fundPlan = calculateSinglePlan(fundInput);
  const max = Math.max(commercialPlan.schedule.length, fundPlan.schedule.length);
  const schedule = [];

  for (let i = 0; i < max; i++) {
    const c = commercialPlan.schedule[i];
    const f = fundPlan.schedule[i];
    const commercialPaidPrincipal = c?.totalPaidPrincipal ?? commercialPlan.summary.totalPrincipal;
    const fundPaidPrincipal = f?.totalPaidPrincipal ?? fundPlan.summary.totalPrincipal;
    const commercialPaidInterest = c?.totalPaidInterest ?? commercialPlan.summary.totalInterest;
    const fundPaidInterest = f?.totalPaidInterest ?? fundPlan.summary.totalInterest;

    schedule.push({
      period: i + 1,
      date: c?.date || f?.date || addMonths(input.firstPaymentDate, i),
      payment: roundMoney((c?.payment || 0) + (f?.payment || 0)),
      principal: roundMoney((c?.principal || 0) + (f?.principal || 0)),
      interest: roundMoney((c?.interest || 0) + (f?.interest || 0)),
      remainingPrincipal: roundMoney((c?.remainingPrincipal || 0) + (f?.remainingPrincipal || 0)),
      totalPaidPrincipal: roundMoney(commercialPaidPrincipal + fundPaidPrincipal),
      totalPaidInterest: roundMoney(commercialPaidInterest + fundPaidInterest),
      commercial: c,
      fund: f,
    });
  }

  return buildPlan(input, schedule);
}

function findNode(schedule, date) {
  return schedule.find((item) => sameMonthOrAfter(item.date, date));
}

function normalizeSchedule(schedule) {
  if (!schedule.length) return [];
  let remainingPrincipal = schedule[0].principal + schedule[0].remainingPrincipal;
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;

  return schedule.map((item, index) => {
    totalPaidPrincipal = roundMoney(totalPaidPrincipal + item.principal);
    totalPaidInterest = roundMoney(totalPaidInterest + item.interest);
    remainingPrincipal = roundMoney(remainingPrincipal - item.principal);
    return {
      ...item,
      period: index + 1,
      remainingPrincipal: Math.max(0, remainingPrincipal),
      totalPaidPrincipal,
      totalPaidInterest,
    };
  });
}

function scheduleByPrincipalPeriods({ principal, annualRate, periods, method, firstPaymentDate }) {
  if (principal <= 0 || periods <= 0) return [];
  return method === 'equalPayment'
    ? buildEqualPaymentSchedule({ principal, annualRate, periods, firstPaymentDate })
    : buildEqualPrincipalSchedule({ principal, annualRate, periods, firstPaymentDate });
}

function scheduleByTargetPayment({ principal, annualRate, targetPayment, method, firstPaymentDate }) {
  if (principal <= 0) return [];
  const monthlyRate = getMonthlyRate(annualRate);

  if (method === 'equalPrincipal') {
    const firstInterest = principal * monthlyRate;
    const monthlyPrincipal = targetPayment - firstInterest;
    if (monthlyPrincipal <= 0) throw new Error('当前月供不足以覆盖利息，无法缩短年限');
    const periods = Math.ceil(principal / monthlyPrincipal);
    return buildEqualPrincipalSchedule({ principal, annualRate, periods, firstPaymentDate });
  }

  if (monthlyRate === 0) {
    const periods = Math.ceil(principal / targetPayment);
    return buildEqualPaymentSchedule({ principal, annualRate, periods, firstPaymentDate });
  }

  if (targetPayment <= principal * monthlyRate) {
    throw new Error('当前月供不足以覆盖利息，无法缩短年限');
  }

  const periods = Math.ceil(Math.log(targetPayment / (targetPayment - principal * monthlyRate)) / Math.log(1 + monthlyRate));
  return buildEqualPaymentSchedule({ principal, annualRate, periods, firstPaymentDate });
}

function calculatePrepayment(plan, prepayInput) {
  const node = findNode(plan.schedule, prepayInput.date);
  if (!node) throw new Error('提前还款日期超出贷款周期');

  const currentRemainingPrincipal = node.remainingPrincipal;
  const amount = Number(prepayInput.amount || 0);
  const penaltyFee = Number(prepayInput.penaltyFee || 0);
  if (amount <= 0) throw new Error('请输入提前还款金额');
  if (amount > currentRemainingPrincipal) throw new Error('提前还款金额不能超过剩余本金');

  const paidSchedule = plan.schedule.filter((x) => x.period <= node.period);
  const newPrincipal = roundMoney(currentRemainingPrincipal - amount);
  const nextDate = addMonths(node.date, 1);
  const originalRemainInterest = sum(plan.schedule.filter((x) => x.period > node.period).map((x) => x.interest));

  let remainSchedule = [];
  if (prepayInput.mode === 'reducePayment') {
    remainSchedule = scheduleByPrincipalPeriods({
      principal: newPrincipal,
      annualRate: plan.input.annualRate,
      periods: plan.summary.totalPeriods - node.period,
      method: plan.input.repaymentMethod,
      firstPaymentDate: nextDate,
    });
  } else {
    remainSchedule = scheduleByTargetPayment({
      principal: newPrincipal,
      annualRate: plan.input.annualRate,
      targetPayment: node.payment,
      method: plan.input.repaymentMethod,
      firstPaymentDate: nextDate,
    });
  }

  const adjustedSchedule = normalizeSchedule([...paidSchedule, ...remainSchedule]);
  const adjustedPlan = buildPlan(plan.input, adjustedSchedule);
  const adjustedRemainInterest = sum(adjustedPlan.schedule.filter((x) => x.period > node.period).map((x) => x.interest));

  return {
    adjustedPlan,
    compare: {
      originalRemainingPrincipal: currentRemainingPrincipal,
      adjustedRemainingPrincipal: newPrincipal,
      originalMonthlyPayment: node.payment,
      adjustedMonthlyPayment: adjustedPlan.schedule[node.period]?.payment || 0,
      originalRemainingPeriods: plan.summary.totalPeriods - node.period,
      adjustedRemainingPeriods: Math.max(0, adjustedPlan.summary.totalPeriods - node.period),
      originalRemainingInterest: originalRemainInterest,
      adjustedRemainingInterest: adjustedRemainInterest,
      savedInterest: roundMoney(originalRemainInterest - adjustedRemainInterest - penaltyFee),
      originalEndDate: plan.summary.endDate,
      adjustedEndDate: adjustedPlan.summary.endDate,
      penaltyFee,
    },
  };
}

function calculateRateAdjust(plan, input) {
  const node = findNode(plan.schedule, input.effectiveDate);
  if (!node) throw new Error('利率调整日期超出贷款周期');

  const paidSchedule = plan.schedule.filter((x) => x.period <= node.period);
  const remainSchedule = scheduleByPrincipalPeriods({
    principal: node.remainingPrincipal,
    annualRate: Number(input.newAnnualRate || 0),
    periods: plan.summary.totalPeriods - node.period,
    method: plan.input.repaymentMethod,
    firstPaymentDate: addMonths(node.date, 1),
  });

  const adjustedSchedule = normalizeSchedule([...paidSchedule, ...remainSchedule]);
  const adjustedPlan = buildPlan({ ...plan.input, annualRate: Number(input.newAnnualRate || 0) }, adjustedSchedule);
  const oldRemainInterest = sum(plan.schedule.filter((x) => x.period > node.period).map((x) => x.interest));
  const newRemainInterest = sum(adjustedPlan.schedule.filter((x) => x.period > node.period).map((x) => x.interest));
  const oldMonthlyPayment = plan.schedule[node.period]?.payment || node.payment;
  const newMonthlyPayment = adjustedPlan.schedule[node.period]?.payment || 0;

  return {
    adjustedPlan,
    compare: {
      oldMonthlyPayment,
      newMonthlyPayment,
      monthlyPaymentDiff: roundMoney(newMonthlyPayment - oldMonthlyPayment),
      oldRemainingInterest: oldRemainInterest,
      newRemainingInterest: newRemainInterest,
      interestDiff: roundMoney(newRemainInterest - oldRemainInterest),
      oldEndDate: plan.summary.endDate,
      newEndDate: adjustedPlan.summary.endDate,
    },
  };
}

function calculateBudgetReverse({ monthlyPayment, years, annualRate, downPaymentRatio }) {
  const periods = Number(years || 0) * 12;
  const monthlyRate = getMonthlyRate(annualRate);
  const m = Number(monthlyPayment || 0);
  if (!m || !periods) return null;

  const ratio = Number(downPaymentRatio || 30);
  if (ratio < 0 || ratio >= 100) return null;

  const loanAmount = monthlyRate === 0
    ? m * periods
    : m * (Math.pow(1 + monthlyRate, periods) - 1) / (monthlyRate * Math.pow(1 + monthlyRate, periods));

  const loanRatio = 1 - ratio / 100;
  const totalHousePrice = loanAmount / loanRatio;
  const downPaymentAmount = totalHousePrice - loanAmount;
  const totalPayment = m * periods;

  return {
    loanAmount: roundMoney(loanAmount),
    totalHousePrice: roundMoney(totalHousePrice),
    downPaymentAmount: roundMoney(downPaymentAmount),
    totalInterest: roundMoney(totalPayment - loanAmount),
    totalPayment: roundMoney(totalPayment),
  };
}

function runCalculatorSelfTests() {
  const baseInput = {
    loanType: 'commercial',
    repaymentMethod: 'equalPayment',
    amount: 1000000,
    years: 30,
    annualRate: 3.5,
    firstPaymentDate: '2026-06-01',
  };

  const plan = calculateMortgagePlan(baseInput);
  console.assert(plan.schedule.length === 360, '等额本息 30 年应生成 360 期');
  console.assert(plan.summary.totalPrincipal === 1000000, '贷款本金应为 1000000');
  console.assert(plan.schedule[0].remainingPrincipal < 1000000, '第一期后剩余本金应减少');
  console.assert(plan.schedule[plan.schedule.length - 1].remainingPrincipal === 0, '最后一期剩余本金应为 0');

  const equalPrincipalPlan = calculateMortgagePlan({ ...baseInput, repaymentMethod: 'equalPrincipal' });
  console.assert(equalPrincipalPlan.schedule[0].payment > equalPrincipalPlan.schedule[1].payment, '等额本金月供应逐月减少');

  const prepay = calculatePrepayment(plan, {
    date: '2028-06-01',
    amount: 100000,
    mode: 'reduceTerm',
    penaltyFee: 0,
  });
  console.assert(prepay.compare.savedInterest > 0, '提前还款缩短年限通常应节省利息');
  console.assert(prepay.compare.adjustedRemainingPeriods < prepay.compare.originalRemainingPeriods, '缩短年限后剩余期数应减少');

  const rateAdjust = calculateRateAdjust(plan, {
    effectiveDate: '2028-06-01',
    newAnnualRate: 3.0,
  });
  console.assert(rateAdjust.compare.interestDiff < 0, '利率下降后剩余利息应减少');

  const budget = calculateBudgetReverse({
    monthlyPayment: 4000,
    years: 30,
    annualRate: 3.5,
    downPaymentRatio: 30,
  });
  console.assert(Boolean(budget && budget.loanAmount > 0), '预算反推应返回可贷款金额');
}

let selfTestsHaveRun = false;
function runSelfTestsOnce() {
  if (selfTestsHaveRun) return;
  selfTestsHaveRun = true;
  try {
    runCalculatorSelfTests();
  } catch (error) {
    console.warn('房贷计算器自检未通过：', error);
  }
}

function StatCard({ title, value, desc, icon }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">{title}</div>
        <div className="text-slate-400">{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {desc ? <div className="mt-1 text-xs text-slate-400">{desc}</div> : null}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium text-slate-700">{label}</div>
      {children}
    </label>
  );
}

function inputClass() {
  return 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100';
}

function SelectButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm transition ${active ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
    >
      {children}
    </button>
  );
}

function CompareTable({ rows }) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-4 py-3 text-left font-medium">指标</th>
            <th className="px-4 py-3 text-right font-medium">当前方案</th>
            <th className="px-4 py-3 text-right font-medium">调整后</th>
            <th className="px-4 py-3 text-right font-medium">差额</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t">
              <td className="px-4 py-3 text-slate-600">{row.label}</td>
              <td className="px-4 py-3 text-right text-slate-900">{row.old}</td>
              <td className="px-4 py-3 text-right text-slate-900">{row.new}</td>
              <td className="px-4 py-3 text-right font-medium text-slate-900">{row.diff}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MortgageCalculatorDemo() {
  runSelfTestsOnce();

  const [activeTab, setActiveTab] = useState('schedule');
  const [input, setInput] = useState({
    loanType: 'commercial',
    repaymentMethod: 'equalPayment',
    amountWan: 100,
    amount: 1000000,
    years: 30,
    annualRate: 3.5,
    firstPaymentDate: '2026-06-01',
    commercialAmountWan: 70,
    commercialAmount: 700000,
    commercialYears: 30,
    commercialRate: 3.5,
    fundAmountWan: 30,
    fundAmount: 300000,
    fundYears: 30,
    fundRate: 2.85,
  });

  const [expandedYear, setExpandedYear] = useState(null);
  const [prepayInput, setPrepayInput] = useState({
    date: '2028-06-01',
    amountWan: 10,
    amount: 100000,
    mode: 'reduceTerm',
    penaltyFee: 0,
  });
  const [rateInput, setRateInput] = useState({ effectiveDate: '2028-06-01', newAnnualRate: 3.0 });
  const [budgetInput, setBudgetInput] = useState({ monthlyPayment: 4000, years: 30, annualRate: 3.5, downPaymentRatio: 30 });

  const plan = useMemo(() => calculateMortgagePlan(input), [input]);

  const prepayResult = useMemo(() => {
    try {
      return calculatePrepayment(plan, prepayInput);
    } catch (error) {
      return { error: error.message };
    }
  }, [plan, prepayInput]);

  const rateResult = useMemo(() => {
    try {
      return calculateRateAdjust(plan, rateInput);
    } catch (error) {
      return { error: error.message };
    }
  }, [plan, rateInput]);

  const budgetResult = useMemo(() => calculateBudgetReverse(budgetInput), [budgetInput]);

  const updateInput = (patch) => setInput((prev) => ({ ...prev, ...patch }));

  const resultText = input.repaymentMethod === 'equalPayment'
    ? `当前方案下，月供约 ${formatMoney(plan.summary.monthlyPayment)}，总利息约 ${formatMoney(plan.summary.totalInterest, 'wan')}，预计 ${plan.summary.endDate} 还清。`
    : `当前方案下，首月月供约 ${formatMoney(plan.summary.firstMonthPayment)}，每月递减约 ${formatMoney(plan.summary.monthlyDecrease)}，总利息约 ${formatMoney(plan.summary.totalInterest, 'wan')}。`;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl bg-gradient-to-br from-slate-950 to-slate-800 p-6 text-white shadow-sm md:p-8">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm text-white/80">
                <Icon name="calculator" size={16} /> 房贷决策工具
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">房贷计算器</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 md:text-base">
                算清月供、总利息、提前还款、利率调整和组合贷，让房贷决策更直观。
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 p-4 text-sm text-white/80">
              计算结果仅供参考，实际以银行为准。
            </div>
          </div>
        </header>

        <section className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">贷款参数</h2>
              <p className="mt-1 text-sm text-slate-500">核心参数默认展开，组合贷会自动拆分计算。</p>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <div className="mb-2 text-sm font-medium text-slate-700">贷款类型</div>
              <div className="flex flex-wrap gap-2">
                <SelectButton active={input.loanType === 'commercial'} onClick={() => updateInput({ loanType: 'commercial' })}>商业贷款</SelectButton>
                <SelectButton active={input.loanType === 'fund'} onClick={() => updateInput({ loanType: 'fund' })}>公积金贷</SelectButton>
                <SelectButton active={input.loanType === 'combined'} onClick={() => updateInput({ loanType: 'combined' })}>组合贷</SelectButton>
              </div>
            </div>

            <div className="lg:col-span-4">
              <div className="mb-2 text-sm font-medium text-slate-700">还款方式</div>
              <div className="flex flex-wrap gap-2">
                <SelectButton active={input.repaymentMethod === 'equalPayment'} onClick={() => updateInput({ repaymentMethod: 'equalPayment' })}>等额本息</SelectButton>
                <SelectButton active={input.repaymentMethod === 'equalPrincipal'} onClick={() => updateInput({ repaymentMethod: 'equalPrincipal' })}>等额本金</SelectButton>
              </div>
            </div>

            <div className="lg:col-span-4">
              <Field label="首次还款日期">
                <input className={inputClass()} type="date" value={input.firstPaymentDate} onChange={(e) => updateInput({ firstPaymentDate: e.target.value })} />
              </Field>
            </div>
          </div>

          {input.loanType !== 'combined' ? (
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <Field label="贷款金额（万元）">
                <input
                  className={inputClass()}
                  type="number"
                  value={input.amountWan}
                  onChange={(e) => updateInput({ amountWan: Number(e.target.value), amount: Number(e.target.value) * 10000 })}
                />
              </Field>
              <Field label="贷款年限">
                <select className={inputClass()} value={input.years} onChange={(e) => updateInput({ years: Number(e.target.value) })}>
                  {[5, 10, 15, 20, 25, 30].map((y) => <option key={y} value={y}>{y} 年</option>)}
                </select>
              </Field>
              <Field label="年利率（%）">
                <input className={inputClass()} type="number" step="0.01" value={input.annualRate} onChange={(e) => updateInput({ annualRate: Number(e.target.value) })} />
              </Field>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <h3 className="mb-4 font-medium">商业贷款</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="金额（万元）">
                    <input className={inputClass()} type="number" value={input.commercialAmountWan} onChange={(e) => updateInput({ commercialAmountWan: Number(e.target.value), commercialAmount: Number(e.target.value) * 10000 })} />
                  </Field>
                  <Field label="年限">
                    <select className={inputClass()} value={input.commercialYears} onChange={(e) => updateInput({ commercialYears: Number(e.target.value) })}>
                      {[5, 10, 15, 20, 25, 30].map((y) => <option key={y} value={y}>{y} 年</option>)}
                    </select>
                  </Field>
                  <Field label="利率（%）">
                    <input className={inputClass()} type="number" step="0.01" value={input.commercialRate} onChange={(e) => updateInput({ commercialRate: Number(e.target.value) })} />
                  </Field>
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <h3 className="mb-4 font-medium">公积金贷款</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="金额（万元）">
                    <input className={inputClass()} type="number" value={input.fundAmountWan} onChange={(e) => updateInput({ fundAmountWan: Number(e.target.value), fundAmount: Number(e.target.value) * 10000 })} />
                  </Field>
                  <Field label="年限">
                    <select className={inputClass()} value={input.fundYears} onChange={(e) => updateInput({ fundYears: Number(e.target.value) })}>
                      {[5, 10, 15, 20, 25, 30].map((y) => <option key={y} value={y}>{y} 年</option>)}
                    </select>
                  </Field>
                  <Field label="利率（%）">
                    <input className={inputClass()} type="number" step="0.01" value={input.fundRate} onChange={(e) => updateInput({ fundRate: Number(e.target.value) })} />
                  </Field>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title={input.repaymentMethod === 'equalPayment' ? '每月月供' : '首月月供'} value={formatMoney(plan.summary.monthlyPayment)} desc={input.repaymentMethod === 'equalPrincipal' ? `每月递减 ${formatMoney(plan.summary.monthlyDecrease)}` : '等额本息固定月供'} icon={<Icon name="card" size={20} />} />
          <StatCard title="总利息" value={formatMoney(plan.summary.totalInterest, 'wan')} desc="完整贷款周期利息" icon={<Icon name="trend" size={20} />} />
          <StatCard title="总还款" value={formatMoney(plan.summary.totalPayment, 'wan')} desc="本金 + 利息" icon={<Icon name="sheet" size={20} />} />
          <StatCard title="还清日期" value={plan.summary.endDate} desc={`${plan.summary.totalPeriods} 期`} icon={<Icon name="calendar" size={20} />} />
        </section>

        <div className="rounded-2xl border bg-white p-4 text-sm leading-6 text-slate-600 shadow-sm">
          {resultText}
        </div>

        <section className="rounded-3xl border bg-white shadow-sm">
          <div className="flex gap-2 overflow-x-auto border-b p-3">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm transition ${activeTab === tab.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-4 md:p-6">
            {activeTab === 'schedule' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">年度汇总</h2>
                  <div className="text-sm text-slate-400">点击年份查看月度明细</div>
                </div>
                <div className="overflow-hidden rounded-2xl border">
                  {plan.annualSummary.map((year) => (
                    <div key={year.year} className="border-b last:border-b-0">
                      <button
                        className="grid w-full grid-cols-2 gap-3 bg-white px-4 py-4 text-left hover:bg-slate-50 md:grid-cols-5"
                        onClick={() => setExpandedYear(expandedYear === year.year ? null : year.year)}
                      >
                        <div className="font-medium">{year.year} 年</div>
                        <div className="text-sm text-slate-600">还款：{formatMoney(year.totalPayment)}</div>
                        <div className="text-sm text-slate-600">本金：{formatMoney(year.totalPrincipal)}</div>
                        <div className="text-sm text-slate-600">利息：{formatMoney(year.totalInterest)}</div>
                        <div className="text-sm text-slate-600">剩余：{formatMoney(year.endRemainingPrincipal)}</div>
                      </button>
                      {expandedYear === year.year && (
                        <div className="overflow-x-auto bg-slate-50 p-3">
                          <table className="min-w-full text-sm">
                            <thead className="text-slate-500">
                              <tr>
                                <th className="px-3 py-2 text-left">期数</th>
                                <th className="px-3 py-2 text-left">日期</th>
                                <th className="px-3 py-2 text-right">月供</th>
                                <th className="px-3 py-2 text-right">本金</th>
                                <th className="px-3 py-2 text-right">利息</th>
                                <th className="px-3 py-2 text-right">剩余本金</th>
                              </tr>
                            </thead>
                            <tbody>
                              {year.months.map((m) => (
                                <tr key={m.period} className="border-t">
                                  <td className="px-3 py-2">{m.period}</td>
                                  <td className="px-3 py-2">{m.date}</td>
                                  <td className="px-3 py-2 text-right">{formatMoney(m.payment)}</td>
                                  <td className="px-3 py-2 text-right">{formatMoney(m.principal)}</td>
                                  <td className="px-3 py-2 text-right">{formatMoney(m.interest)}</td>
                                  <td className="px-3 py-2 text-right">{formatMoney(m.remainingPrincipal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'prepay' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">提前还款测算</h2>
                  <p className="mt-1 text-sm text-slate-500">比较“减少年限”和“减少月供”的差异。</p>
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  <Field label="提前还款日期">
                    <input className={inputClass()} type="date" value={prepayInput.date} onChange={(e) => setPrepayInput((p) => ({ ...p, date: e.target.value }))} />
                  </Field>
                  <Field label="提前还款金额（万元）">
                    <input className={inputClass()} type="number" value={prepayInput.amountWan} onChange={(e) => setPrepayInput((p) => ({ ...p, amountWan: Number(e.target.value), amount: Number(e.target.value) * 10000 }))} />
                  </Field>
                  <Field label="处理方式">
                    <select className={inputClass()} value={prepayInput.mode} onChange={(e) => setPrepayInput((p) => ({ ...p, mode: e.target.value }))}>
                      <option value="reduceTerm">减少年限</option>
                      <option value="reducePayment">减少月供</option>
                    </select>
                  </Field>
                  <Field label="违约金/手续费（元）">
                    <input className={inputClass()} type="number" value={prepayInput.penaltyFee} onChange={(e) => setPrepayInput((p) => ({ ...p, penaltyFee: Number(e.target.value) }))} />
                  </Field>
                </div>

                {prepayResult.error ? (
                  <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">{prepayResult.error}</div>
                ) : (
                  <>
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                      提前还款 {formatMoney(prepayInput.amount)} 后，预计节省利息 {formatMoney(prepayResult.compare.savedInterest)}，还清日期从 {prepayResult.compare.originalEndDate} 变为 {prepayResult.compare.adjustedEndDate}。
                    </div>
                    <CompareTable rows={[
                      { label: '剩余本金', old: formatMoney(prepayResult.compare.originalRemainingPrincipal), new: formatMoney(prepayResult.compare.adjustedRemainingPrincipal), diff: formatMoney(prepayResult.compare.adjustedRemainingPrincipal - prepayResult.compare.originalRemainingPrincipal) },
                      { label: '月供', old: formatMoney(prepayResult.compare.originalMonthlyPayment), new: formatMoney(prepayResult.compare.adjustedMonthlyPayment), diff: formatMoney(prepayResult.compare.adjustedMonthlyPayment - prepayResult.compare.originalMonthlyPayment) },
                      { label: '剩余期数', old: `${prepayResult.compare.originalRemainingPeriods} 期`, new: `${prepayResult.compare.adjustedRemainingPeriods} 期`, diff: `${prepayResult.compare.adjustedRemainingPeriods - prepayResult.compare.originalRemainingPeriods} 期` },
                      { label: '剩余利息', old: formatMoney(prepayResult.compare.originalRemainingInterest), new: formatMoney(prepayResult.compare.adjustedRemainingInterest), diff: formatMoney(prepayResult.compare.adjustedRemainingInterest - prepayResult.compare.originalRemainingInterest) },
                      { label: '还清日期', old: prepayResult.compare.originalEndDate, new: prepayResult.compare.adjustedEndDate, diff: '-' },
                    ]} />
                  </>
                )}
              </div>
            )}

            {activeTab === 'rate' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">利率调整测算</h2>
                  <p className="mt-1 text-sm text-slate-500">模拟存量房贷利率变化后的月供和利息差异。</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="生效日期">
                    <input className={inputClass()} type="date" value={rateInput.effectiveDate} onChange={(e) => setRateInput((p) => ({ ...p, effectiveDate: e.target.value }))} />
                  </Field>
                  <Field label="新年利率（%）">
                    <input className={inputClass()} type="number" step="0.01" value={rateInput.newAnnualRate} onChange={(e) => setRateInput((p) => ({ ...p, newAnnualRate: Number(e.target.value) }))} />
                  </Field>
                </div>

                {rateResult.error ? (
                  <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">{rateResult.error}</div>
                ) : (
                  <>
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                      利率调整后，月供变化 {formatMoney(rateResult.compare.monthlyPaymentDiff)}，剩余利息变化 {formatMoney(rateResult.compare.interestDiff)}。
                    </div>
                    <CompareTable rows={[
                      { label: '月供', old: formatMoney(rateResult.compare.oldMonthlyPayment), new: formatMoney(rateResult.compare.newMonthlyPayment), diff: formatMoney(rateResult.compare.monthlyPaymentDiff) },
                      { label: '剩余利息', old: formatMoney(rateResult.compare.oldRemainingInterest), new: formatMoney(rateResult.compare.newRemainingInterest), diff: formatMoney(rateResult.compare.interestDiff) },
                      { label: '还清日期', old: rateResult.compare.oldEndDate, new: rateResult.compare.newEndDate, diff: '-' },
                    ]} />
                  </>
                )}
              </div>
            )}

            {activeTab === 'compare' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">方案对比</h2>
                  <p className="mt-1 text-sm text-slate-500">当前方案、提前还款方案、利率调整方案横向对比。</p>
                </div>
                <div className="overflow-x-auto rounded-2xl border bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">指标</th>
                        <th className="px-4 py-3 text-right font-medium">当前方案</th>
                        <th className="px-4 py-3 text-right font-medium">提前还款</th>
                        <th className="px-4 py-3 text-right font-medium">利率调整</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['月供', formatMoney(plan.summary.monthlyPayment), prepayResult.error ? '-' : formatMoney(prepayResult.compare.adjustedMonthlyPayment), rateResult.error ? '-' : formatMoney(rateResult.compare.newMonthlyPayment)],
                        ['总利息/剩余利息', formatMoney(plan.summary.totalInterest), prepayResult.error ? '-' : formatMoney(prepayResult.compare.adjustedRemainingInterest), rateResult.error ? '-' : formatMoney(rateResult.compare.newRemainingInterest)],
                        ['总期数/剩余期数', `${plan.summary.totalPeriods} 期`, prepayResult.error ? '-' : `${prepayResult.compare.adjustedRemainingPeriods} 期`, rateResult.error ? '-' : `${plan.summary.totalPeriods} 期`],
                        ['还清日期', plan.summary.endDate, prepayResult.error ? '-' : prepayResult.compare.adjustedEndDate, rateResult.error ? '-' : rateResult.compare.newEndDate],
                        ['节省利息', '-', prepayResult.error ? '-' : formatMoney(prepayResult.compare.savedInterest), rateResult.error ? '-' : formatMoney(-rateResult.compare.interestDiff)],
                      ].map((row) => (
                        <tr key={row[0]} className="border-t">
                          <td className="px-4 py-3 text-slate-600">{row[0]}</td>
                          <td className="px-4 py-3 text-right">{row[1]}</td>
                          <td className="px-4 py-3 text-right">{row[2]}</td>
                          <td className="px-4 py-3 text-right">{row[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'budget' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">买房预算反推</h2>
                  <p className="mt-1 text-sm text-slate-500">根据可承受月供反推可贷款金额和总房价。</p>
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  <Field label="可承受月供（元）">
                    <input className={inputClass()} type="number" value={budgetInput.monthlyPayment} onChange={(e) => setBudgetInput((p) => ({ ...p, monthlyPayment: Number(e.target.value) }))} />
                  </Field>
                  <Field label="贷款年限">
                    <select className={inputClass()} value={budgetInput.years} onChange={(e) => setBudgetInput((p) => ({ ...p, years: Number(e.target.value) }))}>
                      {[5, 10, 15, 20, 25, 30].map((y) => <option key={y} value={y}>{y} 年</option>)}
                    </select>
                  </Field>
                  <Field label="年利率（%）">
                    <input className={inputClass()} type="number" step="0.01" value={budgetInput.annualRate} onChange={(e) => setBudgetInput((p) => ({ ...p, annualRate: Number(e.target.value) }))} />
                  </Field>
                  <Field label="首付比例（%）">
                    <input className={inputClass()} type="number" value={budgetInput.downPaymentRatio} onChange={(e) => setBudgetInput((p) => ({ ...p, downPaymentRatio: Number(e.target.value) }))} />
                  </Field>
                </div>
                {budgetResult ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard title="可贷款金额" value={formatMoney(budgetResult.loanAmount, 'wan')} icon={<Icon name="card" size={20} />} />
                    <StatCard title="预计总房价" value={formatMoney(budgetResult.totalHousePrice, 'wan')} icon={<Icon name="calculator" size={20} />} />
                    <StatCard title="预计首付" value={formatMoney(budgetResult.downPaymentAmount, 'wan')} icon={<Icon name="percent" size={20} />} />
                    <StatCard title="预计总利息" value={formatMoney(budgetResult.totalInterest, 'wan')} icon={<Icon name="trend" size={20} />} />
                  </div>
                ) : (
                  <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">请检查月供、年限、利率和首付比例。</div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
