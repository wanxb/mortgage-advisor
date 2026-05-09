/*
 * 房贷计算器核心计算引擎
 * 文件建议路径：src/core/mortgageCalculator.ts
 *
 * 说明：
 * 1. 本文件不依赖 React，可直接作为纯函数模块使用。
 * 2. 金额单位统一使用“元”。
 * 3. 贷款金额输入如果来自“万元”，请在表单层转换为元后传入。
 * 4. 为了易读，当前版本使用 number；正式金融级精度建议替换为 decimal.js 或 big.js。
 */

export type LoanType = 'commercial' | 'fund' | 'combined';
export type RepaymentMethod = 'equalPayment' | 'equalPrincipal';
export type PrepaymentMode = 'reduceTerm' | 'reducePayment';

export interface SubLoanInput {
  amount: number; // 元
  years: number;
  annualRate: number; // 例如 3.5 表示 3.5%
}

export interface LoanInput {
  loanType: LoanType;
  repaymentMethod: RepaymentMethod;
  amount: number; // 元，单贷时使用
  years: number;
  annualRate: number;
  firstPaymentDate: string; // YYYY-MM-DD
  commercial?: SubLoanInput;
  fund?: SubLoanInput;
}

export interface PaymentScheduleItem {
  period: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  remainingPrincipal: number;
  totalPaidPrincipal: number;
  totalPaidInterest: number;
  commercial?: PaymentScheduleItem;
  fund?: PaymentScheduleItem;
}

export interface AnnualSummaryItem {
  year: number;
  totalPayment: number;
  totalPrincipal: number;
  totalInterest: number;
  endRemainingPrincipal: number;
  months: PaymentScheduleItem[];
}

export interface LoanSummary {
  totalPrincipal: number;
  totalInterest: number;
  totalPayment: number;
  monthlyPayment: number;
  firstMonthPayment?: number;
  lastMonthPayment?: number;
  monthlyDecrease?: number;
  totalPeriods: number;
  endDate: string;
}

export interface LoanPlan {
  input: LoanInput;
  summary: LoanSummary;
  schedule: PaymentScheduleItem[];
  annualSummary: AnnualSummaryItem[];
}

export interface PrepaymentInput {
  date: string; // YYYY-MM-DD，按月份匹配
  amount: number; // 元
  mode: PrepaymentMode;
  includeCurrentMonthPayment?: boolean;
  penaltyFee?: number;
}

export interface PrepaymentCompare {
  originalRemainingPrincipal: number;
  adjustedRemainingPrincipal: number;
  originalMonthlyPayment: number;
  adjustedMonthlyPayment: number;
  originalRemainingPeriods: number;
  adjustedRemainingPeriods: number;
  originalRemainingInterest: number;
  adjustedRemainingInterest: number;
  savedInterest: number;
  originalEndDate: string;
  adjustedEndDate: string;
  penaltyFee: number;
}

export interface PrepaymentResult {
  originalPlan: LoanPlan;
  adjustedPlan: LoanPlan;
  compare: PrepaymentCompare;
}

export interface RateAdjustInput {
  effectiveDate: string; // YYYY-MM-DD
  newAnnualRate: number;
}

export interface RateAdjustCompare {
  oldMonthlyPayment: number;
  newMonthlyPayment: number;
  monthlyPaymentDiff: number;
  oldRemainingInterest: number;
  newRemainingInterest: number;
  interestDiff: number;
  oldEndDate: string;
  newEndDate: string;
}

export interface RateAdjustResult {
  originalPlan: LoanPlan;
  adjustedPlan: LoanPlan;
  compare: RateAdjustCompare;
}

export interface BudgetReverseInput {
  affordableMonthlyPayment: number;
  years: number;
  annualRate: number;
  downPaymentRatio: number; // 例如 30 表示 30%
}

export interface BudgetReverseResult {
  loanAmount: number;
  totalHousePrice: number;
  downPaymentAmount: number;
  totalInterest: number;
  totalPayment: number;
}

const MONEY_PRECISION = 2;

function roundMoney(value: number): number {
  return Number(value.toFixed(MONEY_PRECISION));
}

function sum(values: number[]): number {
  return roundMoney(values.reduce((acc, item) => acc + item, 0));
}

function getMonthlyRate(annualRate: number): number {
  return annualRate / 100 / 12;
}

function getPeriods(years: number): number {
  return years * 12;
}

function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day || 1);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addMonths(date: string, months: number): string {
  const d = parseDate(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);

  // 处理 31 号加月份后溢出的问题
  if (d.getDate() !== day) {
    d.setDate(0);
  }

  return formatDate(d);
}

function getYear(date: string): number {
  return parseDate(date).getFullYear();
}

function sameMonthOrAfter(a: string, b: string): boolean {
  const da = parseDate(a);
  const db = parseDate(b);
  return da.getFullYear() > db.getFullYear()
    || (da.getFullYear() === db.getFullYear() && da.getMonth() >= db.getMonth());
}

function normalizeSchedulePeriods(schedule: PaymentScheduleItem[], firstPeriod = 1): PaymentScheduleItem[] {
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;

  return schedule.map((item, index) => {
    totalPaidPrincipal += item.principal;
    totalPaidInterest += item.interest;

    return {
      ...item,
      period: firstPeriod + index,
      totalPaidPrincipal: roundMoney(totalPaidPrincipal),
      totalPaidInterest: roundMoney(totalPaidInterest),
    };
  });
}

export function validateLoanInput(input: LoanInput): void {
  if (!input) {
    throw new Error('贷款参数不能为空');
  }

  if (!input.firstPaymentDate) {
    throw new Error('首次还款日期不能为空');
  }

  if (!['commercial', 'fund', 'combined'].includes(input.loanType)) {
    throw new Error('贷款类型不正确');
  }

  if (!['equalPayment', 'equalPrincipal'].includes(input.repaymentMethod)) {
    throw new Error('还款方式不正确');
  }

  if (input.loanType === 'combined') {
    if (!input.commercial || !input.fund) {
      throw new Error('组合贷需要填写商贷和公积金贷参数');
    }

    validateSubLoan(input.commercial, '商贷');
    validateSubLoan(input.fund, '公积金贷');
    return;
  }

  if (!input.amount || input.amount <= 0) {
    throw new Error('请输入贷款金额');
  }

  if (!input.years || input.years <= 0) {
    throw new Error('请选择贷款年限');
  }

  if (input.annualRate < 0) {
    throw new Error('贷款利率不能小于 0');
  }
}

function validateSubLoan(input: SubLoanInput, name: string): void {
  if (!input.amount || input.amount <= 0) {
    throw new Error(`请输入${name}金额`);
  }

  if (!input.years || input.years <= 0) {
    throw new Error(`请选择${name}年限`);
  }

  if (input.annualRate < 0) {
    throw new Error(`${name}利率不能小于 0`);
  }
}

export function calculateMortgagePlan(input: LoanInput): LoanPlan {
  validateLoanInput(input);

  if (input.loanType === 'combined') {
    return calculateCombinedLoanPlan(input);
  }

  if (input.repaymentMethod === 'equalPayment') {
    return calculateEqualPaymentPlan(input);
  }

  return calculateEqualPrincipalPlan(input);
}

export function calculateEqualPaymentPlan(input: LoanInput): LoanPlan {
  const principal = input.amount;
  const monthlyRate = getMonthlyRate(input.annualRate);
  const periods = getPeriods(input.years);

  let monthlyPayment: number;

  if (monthlyRate === 0) {
    monthlyPayment = principal / periods;
  } else {
    monthlyPayment = principal * monthlyRate * Math.pow(1 + monthlyRate, periods)
      / (Math.pow(1 + monthlyRate, periods) - 1);
  }

  const schedule = buildEqualPaymentSchedule({
    principal,
    monthlyRate,
    periods,
    monthlyPayment,
    firstPaymentDate: input.firstPaymentDate,
  });

  return buildLoanPlan(input, schedule);
}

function buildEqualPaymentSchedule(params: {
  principal: number;
  monthlyRate: number;
  periods: number;
  monthlyPayment: number;
  firstPaymentDate: string;
}): PaymentScheduleItem[] {
  const { principal, monthlyRate, periods, firstPaymentDate } = params;
  let monthlyPayment = params.monthlyPayment;

  const schedule: PaymentScheduleItem[] = [];
  let remainingPrincipal = principal;
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;

  for (let i = 1; i <= periods; i++) {
    const interest = monthlyRate === 0 ? 0 : remainingPrincipal * monthlyRate;
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

    if (remainingPrincipal <= 0) {
      break;
    }
  }

  return schedule;
}

export function calculateEqualPrincipalPlan(input: LoanInput): LoanPlan {
  const principal = input.amount;
  const monthlyRate = getMonthlyRate(input.annualRate);
  const periods = getPeriods(input.years);
  const monthlyPrincipal = principal / periods;

  const schedule = buildEqualPrincipalSchedule({
    principal,
    monthlyRate,
    periods,
    monthlyPrincipal,
    firstPaymentDate: input.firstPaymentDate,
  });

  return buildLoanPlan(input, schedule);
}

function buildEqualPrincipalSchedule(params: {
  principal: number;
  monthlyRate: number;
  periods: number;
  monthlyPrincipal: number;
  firstPaymentDate: string;
}): PaymentScheduleItem[] {
  const { principal, monthlyRate, periods, monthlyPrincipal, firstPaymentDate } = params;

  const schedule: PaymentScheduleItem[] = [];
  let remainingPrincipal = principal;
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;

  for (let i = 1; i <= periods; i++) {
    const interest = monthlyRate === 0 ? 0 : remainingPrincipal * monthlyRate;
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

    if (remainingPrincipal <= 0) {
      break;
    }
  }

  return schedule;
}

export function calculateCombinedLoanPlan(input: LoanInput): LoanPlan {
  if (!input.commercial || !input.fund) {
    throw new Error('组合贷参数不完整');
  }

  const commercialInput: LoanInput = {
    ...input,
    loanType: 'commercial',
    amount: input.commercial.amount,
    years: input.commercial.years,
    annualRate: input.commercial.annualRate,
  };

  const fundInput: LoanInput = {
    ...input,
    loanType: 'fund',
    amount: input.fund.amount,
    years: input.fund.years,
    annualRate: input.fund.annualRate,
  };

  const commercialPlan = input.repaymentMethod === 'equalPayment'
    ? calculateEqualPaymentPlan(commercialInput)
    : calculateEqualPrincipalPlan(commercialInput);

  const fundPlan = input.repaymentMethod === 'equalPayment'
    ? calculateEqualPaymentPlan(fundInput)
    : calculateEqualPrincipalPlan(fundInput);

  const maxPeriods = Math.max(commercialPlan.schedule.length, fundPlan.schedule.length);
  const mergedSchedule: PaymentScheduleItem[] = [];

  for (let i = 0; i < maxPeriods; i++) {
    const commercial = commercialPlan.schedule[i];
    const fund = fundPlan.schedule[i];

    mergedSchedule.push({
      period: i + 1,
      date: commercial?.date || fund?.date || addMonths(input.firstPaymentDate, i),
      payment: roundMoney((commercial?.payment || 0) + (fund?.payment || 0)),
      principal: roundMoney((commercial?.principal || 0) + (fund?.principal || 0)),
      interest: roundMoney((commercial?.interest || 0) + (fund?.interest || 0)),
      remainingPrincipal: roundMoney((commercial?.remainingPrincipal || 0) + (fund?.remainingPrincipal || 0)),
      totalPaidPrincipal: roundMoney((commercial?.totalPaidPrincipal || commercialPlan.summary.totalPrincipal) + (fund?.totalPaidPrincipal || fundPlan.summary.totalPrincipal)),
      totalPaidInterest: roundMoney((commercial?.totalPaidInterest || commercialPlan.summary.totalInterest) + (fund?.totalPaidInterest || fundPlan.summary.totalInterest)),
      commercial,
      fund,
    });
  }

  return buildLoanPlan(input, mergedSchedule);
}

function buildLoanPlan(input: LoanInput, schedule: PaymentScheduleItem[]): LoanPlan {
  const totalPrincipal = input.loanType === 'combined'
    ? (input.commercial?.amount || 0) + (input.fund?.amount || 0)
    : input.amount;

  const totalInterest = sum(schedule.map(x => x.interest));
  const totalPayment = roundMoney(totalPrincipal + totalInterest);
  const first = schedule[0];
  const last = schedule[schedule.length - 1];

  const monthlyPayment = input.repaymentMethod === 'equalPayment'
    ? first?.payment || 0
    : first?.payment || 0;

  const summary: LoanSummary = {
    totalPrincipal: roundMoney(totalPrincipal),
    totalInterest: roundMoney(totalInterest),
    totalPayment: roundMoney(totalPayment),
    monthlyPayment: roundMoney(monthlyPayment),
    firstMonthPayment: first?.payment,
    lastMonthPayment: last?.payment,
    monthlyDecrease: input.repaymentMethod === 'equalPrincipal' && schedule.length >= 2
      ? roundMoney(schedule[0].payment - schedule[1].payment)
      : undefined,
    totalPeriods: schedule.length,
    endDate: last?.date || input.firstPaymentDate,
  };

  return {
    input,
    summary,
    schedule,
    annualSummary: buildAnnualSummary(schedule),
  };
}

export function buildAnnualSummary(schedule: PaymentScheduleItem[]): AnnualSummaryItem[] {
  const yearMap = new Map<number, PaymentScheduleItem[]>();

  schedule.forEach(item => {
    const year = getYear(item.date);
    const list = yearMap.get(year) || [];
    list.push(item);
    yearMap.set(year, list);
  });

  return Array.from(yearMap.entries()).map(([year, months]) => ({
    year,
    totalPayment: sum(months.map(x => x.payment)),
    totalPrincipal: sum(months.map(x => x.principal)),
    totalInterest: sum(months.map(x => x.interest)),
    endRemainingPrincipal: months[months.length - 1]?.remainingPrincipal || 0,
    months,
  }));
}

function findNodeByDate(schedule: PaymentScheduleItem[], date: string): PaymentScheduleItem {
  const node = schedule.find(item => sameMonthOrAfter(item.date, date));
  if (!node) {
    throw new Error('日期超出贷款还款周期');
  }
  return node;
}

function getPaidSchedule(originalPlan: LoanPlan, node: PaymentScheduleItem, includeCurrentMonthPayment = true): PaymentScheduleItem[] {
  if (includeCurrentMonthPayment) {
    return originalPlan.schedule.filter(item => item.period <= node.period);
  }

  return originalPlan.schedule.filter(item => item.period < node.period);
}

function getRemainingInterestFromPeriod(plan: LoanPlan, startPeriod: number): number {
  return sum(plan.schedule.filter(item => item.period > startPeriod).map(item => item.interest));
}

export function calculatePrepaymentPlan(originalPlan: LoanPlan, input: PrepaymentInput): PrepaymentResult {
  const node = findNodeByDate(originalPlan.schedule, input.date);
  const includeCurrentMonthPayment = input.includeCurrentMonthPayment ?? true;

  const paidSchedule = getPaidSchedule(originalPlan, node, includeCurrentMonthPayment);
  const baseNode = includeCurrentMonthPayment
    ? paidSchedule[paidSchedule.length - 1]
    : originalPlan.schedule[node.period - 2];

  const currentRemainingPrincipal = includeCurrentMonthPayment
    ? node.remainingPrincipal
    : (baseNode?.remainingPrincipal ?? originalPlan.summary.totalPrincipal);

  if (input.amount <= 0) {
    throw new Error('提前还款金额必须大于 0');
  }

  if (input.amount > currentRemainingPrincipal) {
    throw new Error('提前还款金额不能超过剩余本金');
  }

  if (input.mode === 'reducePayment') {
    return calculateReducePaymentPrepayment(originalPlan, paidSchedule, node, currentRemainingPrincipal, input);
  }

  return calculateReduceTermPrepayment(originalPlan, paidSchedule, node, currentRemainingPrincipal, input);
}

function calculateReducePaymentPrepayment(
  originalPlan: LoanPlan,
  paidSchedule: PaymentScheduleItem[],
  node: PaymentScheduleItem,
  currentRemainingPrincipal: number,
  input: PrepaymentInput
): PrepaymentResult {
  const newPrincipal = roundMoney(currentRemainingPrincipal - input.amount);
  const remainingPeriods = originalPlan.summary.totalPeriods - node.period;
  const nextPaymentDate = addMonths(node.date, 1);

  const remainingSchedule = calculateScheduleByPrincipalPeriodsRate({
    principal: newPrincipal,
    periods: remainingPeriods,
    annualRate: originalPlan.input.annualRate,
    repaymentMethod: originalPlan.input.repaymentMethod,
    firstPaymentDate: nextPaymentDate,
  });

  const adjustedSchedule = normalizeFullSchedule([...paidSchedule, ...remainingSchedule]);
  const adjustedPlan = buildLoanPlanFromSchedule(originalPlan.input, adjustedSchedule);

  return buildPrepaymentResult(originalPlan, adjustedPlan, node, input, currentRemainingPrincipal);
}

function calculateReduceTermPrepayment(
  originalPlan: LoanPlan,
  paidSchedule: PaymentScheduleItem[],
  node: PaymentScheduleItem,
  currentRemainingPrincipal: number,
  input: PrepaymentInput
): PrepaymentResult {
  const newPrincipal = roundMoney(currentRemainingPrincipal - input.amount);
  const monthlyRate = getMonthlyRate(originalPlan.input.annualRate);
  const targetPayment = node.payment;
  const nextPaymentDate = addMonths(node.date, 1);

  const remainingSchedule = calculateScheduleByTargetPayment({
    principal: newPrincipal,
    targetPayment,
    monthlyRate,
    repaymentMethod: originalPlan.input.repaymentMethod,
    firstPaymentDate: nextPaymentDate,
  });

  const adjustedSchedule = normalizeFullSchedule([...paidSchedule, ...remainingSchedule]);
  const adjustedPlan = buildLoanPlanFromSchedule(originalPlan.input, adjustedSchedule);

  return buildPrepaymentResult(originalPlan, adjustedPlan, node, input, currentRemainingPrincipal);
}

function calculateScheduleByPrincipalPeriodsRate(params: {
  principal: number;
  periods: number;
  annualRate: number;
  repaymentMethod: RepaymentMethod;
  firstPaymentDate: string;
}): PaymentScheduleItem[] {
  const { principal, periods, annualRate, repaymentMethod, firstPaymentDate } = params;
  const monthlyRate = getMonthlyRate(annualRate);

  if (principal <= 0 || periods <= 0) {
    return [];
  }

  if (repaymentMethod === 'equalPayment') {
    const monthlyPayment = monthlyRate === 0
      ? principal / periods
      : principal * monthlyRate * Math.pow(1 + monthlyRate, periods)
        / (Math.pow(1 + monthlyRate, periods) - 1);

    return buildEqualPaymentSchedule({
      principal,
      monthlyRate,
      periods,
      monthlyPayment,
      firstPaymentDate,
    });
  }

  return buildEqualPrincipalSchedule({
    principal,
    monthlyRate,
    periods,
    monthlyPrincipal: principal / periods,
    firstPaymentDate,
  });
}

function calculateScheduleByTargetPayment(params: {
  principal: number;
  targetPayment: number;
  monthlyRate: number;
  repaymentMethod: RepaymentMethod;
  firstPaymentDate: string;
}): PaymentScheduleItem[] {
  const { principal, targetPayment, monthlyRate, repaymentMethod, firstPaymentDate } = params;

  if (principal <= 0) {
    return [];
  }

  if (repaymentMethod === 'equalPrincipal') {
    // 等额本金缩短年限：保持首期月供不超过原目标月供，反推每月本金
    const firstInterest = principal * monthlyRate;
    const monthlyPrincipal = targetPayment - firstInterest;

    if (monthlyPrincipal <= 0) {
      throw new Error('当前月供不足以覆盖利息，无法计算缩短年限');
    }

    const periods = Math.ceil(principal / monthlyPrincipal);

    return buildEqualPrincipalSchedule({
      principal,
      monthlyRate,
      periods,
      monthlyPrincipal,
      firstPaymentDate,
    });
  }

  if (monthlyRate === 0) {
    const periods = Math.ceil(principal / targetPayment);
    return buildEqualPaymentSchedule({
      principal,
      monthlyRate,
      periods,
      monthlyPayment: targetPayment,
      firstPaymentDate,
    });
  }

  if (targetPayment <= principal * monthlyRate) {
    throw new Error('当前月供不足以覆盖利息，无法计算缩短年限');
  }

  const periods = Math.ceil(
    Math.log(targetPayment / (targetPayment - principal * monthlyRate))
    / Math.log(1 + monthlyRate)
  );

  return buildEqualPaymentSchedule({
    principal,
    monthlyRate,
    periods,
    monthlyPayment: targetPayment,
    firstPaymentDate,
  });
}

function normalizeFullSchedule(schedule: PaymentScheduleItem[]): PaymentScheduleItem[] {
  let remainingPrincipal = schedule[0]
    ? schedule[0].principal + schedule[0].remainingPrincipal
    : 0;
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;

  return schedule.map((item, index) => {
    totalPaidPrincipal = roundMoney(totalPaidPrincipal + item.principal);
    totalPaidInterest = roundMoney(totalPaidInterest + item.interest);
    remainingPrincipal = roundMoney(remainingPrincipal - item.principal);

    return {
      ...item,
      period: index + 1,
      remainingPrincipal: Math.max(0, roundMoney(remainingPrincipal)),
      totalPaidPrincipal,
      totalPaidInterest,
    };
  });
}

function buildLoanPlanFromSchedule(input: LoanInput, schedule: PaymentScheduleItem[]): LoanPlan {
  return buildLoanPlan(input, schedule);
}

function buildPrepaymentResult(
  originalPlan: LoanPlan,
  adjustedPlan: LoanPlan,
  node: PaymentScheduleItem,
  input: PrepaymentInput,
  currentRemainingPrincipal: number
): PrepaymentResult {
  const penaltyFee = input.penaltyFee || 0;
  const adjustedNode = adjustedPlan.schedule.find(item => item.period === node.period) || adjustedPlan.schedule[node.period - 1];

  const originalRemainingInterest = getRemainingInterestFromPeriod(originalPlan, node.period);
  const adjustedRemainingInterest = sum(
    adjustedPlan.schedule.filter(item => item.period > node.period).map(item => item.interest)
  );

  const savedInterest = roundMoney(originalRemainingInterest - adjustedRemainingInterest - penaltyFee);

  const compare: PrepaymentCompare = {
    originalRemainingPrincipal: roundMoney(currentRemainingPrincipal),
    adjustedRemainingPrincipal: roundMoney(Math.max(0, currentRemainingPrincipal - input.amount)),
    originalMonthlyPayment: roundMoney(node.payment),
    adjustedMonthlyPayment: roundMoney(adjustedPlan.schedule[node.period]?.payment || adjustedNode?.payment || 0),
    originalRemainingPeriods: originalPlan.summary.totalPeriods - node.period,
    adjustedRemainingPeriods: Math.max(0, adjustedPlan.summary.totalPeriods - node.period),
    originalRemainingInterest,
    adjustedRemainingInterest,
    savedInterest,
    originalEndDate: originalPlan.summary.endDate,
    adjustedEndDate: adjustedPlan.summary.endDate,
    penaltyFee,
  };

  return {
    originalPlan,
    adjustedPlan,
    compare,
  };
}

export function calculateRateAdjustedPlan(
  originalPlan: LoanPlan,
  input: RateAdjustInput
): RateAdjustResult {
  const node = findNodeByDate(originalPlan.schedule, input.effectiveDate);
  const paidSchedule = originalPlan.schedule.filter(item => item.period <= node.period);
  const currentRemainingPrincipal = node.remainingPrincipal;
  const remainingPeriods = originalPlan.summary.totalPeriods - node.period;

  if (input.newAnnualRate < 0) {
    throw new Error('新利率不能小于 0');
  }

  const remainingSchedule = calculateScheduleByPrincipalPeriodsRate({
    principal: currentRemainingPrincipal,
    periods: remainingPeriods,
    annualRate: input.newAnnualRate,
    repaymentMethod: originalPlan.input.repaymentMethod,
    firstPaymentDate: addMonths(node.date, 1),
  });

  const adjustedSchedule = normalizeFullSchedule([...paidSchedule, ...remainingSchedule]);
  const adjustedPlan = buildLoanPlanFromSchedule(
    {
      ...originalPlan.input,
      annualRate: input.newAnnualRate,
    },
    adjustedSchedule
  );

  const oldRemainingInterest = getRemainingInterestFromPeriod(originalPlan, node.period);
  const newRemainingInterest = sum(
    adjustedPlan.schedule.filter(item => item.period > node.period).map(item => item.interest)
  );

  const oldMonthlyPayment = originalPlan.schedule[node.period]?.payment || node.payment;
  const newMonthlyPayment = adjustedPlan.schedule[node.period]?.payment || 0;

  const compare: RateAdjustCompare = {
    oldMonthlyPayment: roundMoney(oldMonthlyPayment),
    newMonthlyPayment: roundMoney(newMonthlyPayment),
    monthlyPaymentDiff: roundMoney(newMonthlyPayment - oldMonthlyPayment),
    oldRemainingInterest,
    newRemainingInterest,
    interestDiff: roundMoney(newRemainingInterest - oldRemainingInterest),
    oldEndDate: originalPlan.summary.endDate,
    newEndDate: adjustedPlan.summary.endDate,
  };

  return {
    originalPlan,
    adjustedPlan,
    compare,
  };
}

export function calculateBudgetReverse(input: BudgetReverseInput): BudgetReverseResult {
  const monthlyPayment = input.affordableMonthlyPayment;
  const periods = getPeriods(input.years);
  const monthlyRate = getMonthlyRate(input.annualRate);

  if (monthlyPayment <= 0) {
    throw new Error('可承受月供必须大于 0');
  }

  if (input.downPaymentRatio < 0 || input.downPaymentRatio >= 100) {
    throw new Error('首付比例必须在 0 到 100 之间');
  }

  let loanAmount: number;

  if (monthlyRate === 0) {
    loanAmount = monthlyPayment * periods;
  } else {
    loanAmount = monthlyPayment * (Math.pow(1 + monthlyRate, periods) - 1)
      / (monthlyRate * Math.pow(1 + monthlyRate, periods));
  }

  const loanRatio = 1 - input.downPaymentRatio / 100;
  const totalHousePrice = loanAmount / loanRatio;
  const downPaymentAmount = totalHousePrice * input.downPaymentRatio / 100;
  const totalPayment = monthlyPayment * periods;
  const totalInterest = totalPayment - loanAmount;

  return {
    loanAmount: roundMoney(loanAmount),
    totalHousePrice: roundMoney(totalHousePrice),
    downPaymentAmount: roundMoney(downPaymentAmount),
    totalInterest: roundMoney(totalInterest),
    totalPayment: roundMoney(totalPayment),
  };
}

export function formatMoney(value: number, options?: { unit?: 'yuan' | 'wan'; decimals?: number }): string {
  const unit = options?.unit || 'yuan';
  const decimals = options?.decimals ?? 2;

  if (unit === 'wan') {
    return `${(value / 10000).toFixed(decimals)} 万元`;
  }

  return `${value.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} 元`;
}

export function getPressureLevel(monthlyPayment: number, familyMonthlyIncome: number): {
  ratio: number;
  level: 'low' | 'medium' | 'high' | 'danger';
  text: string;
} {
  if (familyMonthlyIncome <= 0) {
    throw new Error('家庭月收入必须大于 0');
  }

  const ratio = monthlyPayment / familyMonthlyIncome * 100;

  if (ratio <= 30) {
    return { ratio: roundMoney(ratio), level: 'low', text: '压力较低' };
  }

  if (ratio <= 40) {
    return { ratio: roundMoney(ratio), level: 'medium', text: '压力适中' };
  }

  if (ratio <= 50) {
    return { ratio: roundMoney(ratio), level: 'high', text: '压力偏高' };
  }

  return { ratio: roundMoney(ratio), level: 'danger', text: '风险较高' };
}

/*
 * 使用示例：
 *
 * const plan = calculateMortgagePlan({
 *   loanType: 'commercial',
 *   repaymentMethod: 'equalPayment',
 *   amount: 1000000,
 *   years: 30,
 *   annualRate: 3.5,
 *   firstPaymentDate: '2026-06-01',
 * });
 *
 * const prepay = calculatePrepaymentPlan(plan, {
 *   date: '2028-06-01',
 *   amount: 100000,
 *   mode: 'reduceTerm',
 *   includeCurrentMonthPayment: true,
 *   penaltyFee: 0,
 * });
 *
 * const rateAdjusted = calculateRateAdjustedPlan(plan, {
 *   effectiveDate: '2028-06-01',
 *   newAnnualRate: 3.0,
 * });
 */
