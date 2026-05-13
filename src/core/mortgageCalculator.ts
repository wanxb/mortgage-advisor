import { addMonths, getYear, sameMonthOrAfter } from '../utils/date';
import { roundMoney, sum, formatMoney } from '../utils/money';
import type {
  AnnualSummaryItem,
  BudgetReverseInput,
  BudgetReverseResult,
  HistoricalLoanEvent,
  HistoricalLoanResult,
  LoanInput,
  LoanPlan,
  PaymentScheduleItem,
  PrepaymentComparisonInput,
  PrepaymentComparisonResult,
  PrepaymentInput,
  PrepaymentResult,
  RateSegmentSummary,
  RateAdjustInput,
  RateAdjustResult,
  RepaymentMethod,
  SubLoanInput,
} from '../types/mortgage';

export { formatMoney };

function getMonthlyRate(annualRate: number): number {
  return Number(annualRate || 0) / 100 / 12;
}

function getPeriods(years: number): number {
  return Math.round(Number(years || 0) * 12);
}

function getMonthKey(date: string): string {
  return date.slice(0, 7);
}

export function validateLoanInput(input: LoanInput): void {
  if (!input.firstPaymentDate) throw new Error('首次还款日期不能为空');
  if (!['commercial', 'fund', 'combined'].includes(input.loanType)) throw new Error('贷款类型不正确');
  if (!['equalPayment', 'equalPrincipal'].includes(input.repaymentMethod)) throw new Error('还款方式不正确');

  if (input.loanType === 'combined') {
    if (!input.commercial || !input.fund) throw new Error('组合贷需要填写商贷和公积金贷参数');
    validateSubLoan(input.commercial, '商贷');
    validateSubLoan(input.fund, '公积金贷');
    return;
  }

  validateSubLoan(input, input.loanType === 'fund' ? '公积金贷' : '贷款');
}

function validateSubLoan(input: SubLoanInput, name: string): void {
  if (!input.amount || input.amount <= 0) throw new Error(`请输入${name}金额`);
  if (!input.years || input.years <= 0) throw new Error(`请选择${name}年限`);
  if (input.annualRate < 0) throw new Error(`${name}利率不能小于 0`);
}

export function calculateMortgagePlan(input: LoanInput): LoanPlan {
  validateLoanInput(input);
  if (input.loanType === 'combined') return calculateCombinedLoanPlan(input);
  return input.repaymentMethod === 'equalPayment'
    ? calculateEqualPaymentPlan(input)
    : calculateEqualPrincipalPlan(input);
}

export function calculateEqualPaymentPlan(input: LoanInput): LoanPlan {
  const principal = input.amount;
  const monthlyRate = getMonthlyRate(input.annualRate);
  const periods = getPeriods(input.years);
  const monthlyPayment = monthlyRate === 0
    ? principal / periods
    : principal * monthlyRate * Math.pow(1 + monthlyRate, periods) / (Math.pow(1 + monthlyRate, periods) - 1);

  return buildLoanPlan(input, buildEqualPaymentSchedule({
    principal,
    annualRate: input.annualRate,
    monthlyRate,
    periods,
    monthlyPayment,
    firstPaymentDate: input.firstPaymentDate,
  }));
}

function buildEqualPaymentSchedule(params: {
  principal: number;
  annualRate: number;
  monthlyRate: number;
  periods: number;
  monthlyPayment: number;
  firstPaymentDate: string;
}): PaymentScheduleItem[] {
  const schedule: PaymentScheduleItem[] = [];
  let monthlyPayment = params.monthlyPayment;
  let remainingPrincipal = params.principal;
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;

  for (let i = 1; i <= params.periods; i += 1) {
    const interest = params.monthlyRate === 0 ? 0 : remainingPrincipal * params.monthlyRate;
    let principal = monthlyPayment - interest;

    if (i === params.periods || principal > remainingPrincipal) {
      principal = remainingPrincipal;
      monthlyPayment = principal + interest;
    }

    remainingPrincipal = roundMoney(remainingPrincipal - principal);
    totalPaidPrincipal = roundMoney(totalPaidPrincipal + principal);
    totalPaidInterest = roundMoney(totalPaidInterest + interest);

    schedule.push({
      period: i,
      date: addMonths(params.firstPaymentDate, i - 1),
      annualRate: params.annualRate,
      payment: roundMoney(monthlyPayment),
      principal: roundMoney(principal),
      interest: roundMoney(interest),
      remainingPrincipal: Math.max(0, roundMoney(remainingPrincipal)),
      totalPaidPrincipal,
      totalPaidInterest,
    });

    if (remainingPrincipal <= 0) break;
  }

  return schedule;
}

export function calculateEqualPrincipalPlan(input: LoanInput): LoanPlan {
  const principal = input.amount;
  const monthlyRate = getMonthlyRate(input.annualRate);
  const periods = getPeriods(input.years);

  return buildLoanPlan(input, buildEqualPrincipalSchedule({
    principal,
    annualRate: input.annualRate,
    monthlyRate,
    periods,
    monthlyPrincipal: principal / periods,
    firstPaymentDate: input.firstPaymentDate,
  }));
}

function buildEqualPrincipalSchedule(params: {
  principal: number;
  annualRate: number;
  monthlyRate: number;
  periods: number;
  monthlyPrincipal: number;
  firstPaymentDate: string;
}): PaymentScheduleItem[] {
  const schedule: PaymentScheduleItem[] = [];
  let remainingPrincipal = params.principal;
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;

  for (let i = 1; i <= params.periods; i += 1) {
    const interest = params.monthlyRate === 0 ? 0 : remainingPrincipal * params.monthlyRate;
    const principal = i === params.periods || params.monthlyPrincipal > remainingPrincipal
      ? remainingPrincipal
      : params.monthlyPrincipal;
    const payment = principal + interest;

    remainingPrincipal = roundMoney(remainingPrincipal - principal);
    totalPaidPrincipal = roundMoney(totalPaidPrincipal + principal);
    totalPaidInterest = roundMoney(totalPaidInterest + interest);

    schedule.push({
      period: i,
      date: addMonths(params.firstPaymentDate, i - 1),
      annualRate: params.annualRate,
      payment: roundMoney(payment),
      principal: roundMoney(principal),
      interest: roundMoney(interest),
      remainingPrincipal: Math.max(0, roundMoney(remainingPrincipal)),
      totalPaidPrincipal,
      totalPaidInterest,
    });

    if (remainingPrincipal <= 0) break;
  }

  return schedule;
}

export function calculateCombinedLoanPlan(input: LoanInput): LoanPlan {
  if (!input.commercial || !input.fund) throw new Error('组合贷参数不完整');

  const commercialPlan = calculateMortgagePlan({
    ...input,
    loanType: 'commercial',
    amount: input.commercial.amount,
    years: input.commercial.years,
    annualRate: input.commercial.annualRate,
  });
  const fundPlan = calculateMortgagePlan({
    ...input,
    loanType: 'fund',
    amount: input.fund.amount,
    years: input.fund.years,
    annualRate: input.fund.annualRate,
  });

  const maxPeriods = Math.max(commercialPlan.schedule.length, fundPlan.schedule.length);
  const schedule: PaymentScheduleItem[] = [];

  for (let i = 0; i < maxPeriods; i += 1) {
    const commercial = commercialPlan.schedule[i];
    const fund = fundPlan.schedule[i];
    schedule.push({
      period: i + 1,
      date: commercial?.date || fund?.date || addMonths(input.firstPaymentDate, i),
      // Only set annualRate when exactly one sub-loan is active; undefined when both are active (rates differ)
      annualRate: (!commercial || !fund) ? (commercial?.annualRate ?? fund?.annualRate) : undefined,
      payment: roundMoney((commercial?.payment || 0) + (fund?.payment || 0)),
      principal: roundMoney((commercial?.principal || 0) + (fund?.principal || 0)),
      interest: roundMoney((commercial?.interest || 0) + (fund?.interest || 0)),
      remainingPrincipal: roundMoney((commercial?.remainingPrincipal || 0) + (fund?.remainingPrincipal || 0)),
      totalPaidPrincipal: roundMoney((commercial?.totalPaidPrincipal ?? commercialPlan.summary.totalPrincipal) + (fund?.totalPaidPrincipal ?? fundPlan.summary.totalPrincipal)),
      totalPaidInterest: roundMoney((commercial?.totalPaidInterest ?? commercialPlan.summary.totalInterest) + (fund?.totalPaidInterest ?? fundPlan.summary.totalInterest)),
      commercial,
      fund,
    });
  }

  return buildLoanPlan(input, schedule);
}

function getInputPrincipal(input: LoanInput): number {
  return input.loanType === 'combined'
    ? (input.commercial?.amount || 0) + (input.fund?.amount || 0)
    : input.amount;
}

function buildLoanPlan(input: LoanInput, schedule: PaymentScheduleItem[]): LoanPlan {
  const totalPrincipal = roundMoney(getInputPrincipal(input));
  const totalInterest = sum(schedule.map((x) => x.interest));
  const first = schedule[0];
  const last = schedule[schedule.length - 1];

  return {
    input,
    schedule,
    annualSummary: buildAnnualSummary(schedule),
    summary: {
      totalPrincipal,
      totalInterest,
      totalPayment: roundMoney(totalPrincipal + totalInterest),
      monthlyPayment: roundMoney(first?.payment || 0),
      firstMonthPayment: roundMoney(first?.payment || 0),
      lastMonthPayment: roundMoney(last?.payment || 0),
      monthlyDecrease: input.repaymentMethod === 'equalPrincipal' && schedule.length >= 2
        ? roundMoney(schedule[0].payment - schedule[1].payment)
        : undefined,
      totalPeriods: schedule.length,
      endDate: last?.date || input.firstPaymentDate,
    },
  };
}

export function buildAnnualSummary(schedule: PaymentScheduleItem[]): AnnualSummaryItem[] {
  const yearMap = new Map<number, { sourceMonths: PaymentScheduleItem[]; displayMonths: PaymentScheduleItem[] }>();
  schedule.forEach((item) => {
    const year = getYear(item.date);
    const group = yearMap.get(year) || { sourceMonths: [], displayMonths: [] };
    group.sourceMonths.push(item);
    group.displayMonths.push(...getDisplayScheduleItems(item));
    yearMap.set(year, group);
  });

  return Array.from(yearMap.entries()).map(([year, { sourceMonths, displayMonths }]) => ({
    year,
    totalPayment: sum(sourceMonths.map((x) => x.payment)),
    totalPrincipal: sum(sourceMonths.map((x) => x.principal)),
    totalInterest: sum(sourceMonths.map((x) => x.interest)),
    endRemainingPrincipal: sourceMonths[sourceMonths.length - 1]?.remainingPrincipal || 0,
    months: displayMonths,
  }));
}

function getDisplayScheduleItems(item: PaymentScheduleItem): PaymentScheduleItem[] {
  const rows: PaymentScheduleItem[] = [];
  if (item.commercial) rows.push({ ...item.commercial, period: item.period, date: item.date, loanPart: 'commercial' });
  if (item.fund) rows.push({ ...item.fund, period: item.period, date: item.date, loanPart: 'fund' });
  return rows.length > 0 ? rows : [item];
}

function findNodeByDate(schedule: PaymentScheduleItem[], date: string): PaymentScheduleItem {
  const node = schedule.find((item) => sameMonthOrAfter(item.date, date));
  if (!node) throw new Error('日期超出贷款还款周期');
  return node;
}

// For combined loans, derive a blended rate from active sub-loans weighted by remaining principal.
function getEffectiveAnnualRate(node: PaymentScheduleItem, input: LoanInput): number {
  if (input.loanType === 'combined') {
    const comm = node.commercial;
    const fund = node.fund;
    if (comm && !fund) return comm.annualRate ?? input.commercial?.annualRate ?? 0;
    if (fund && !comm) return fund.annualRate ?? input.fund?.annualRate ?? 0;
    if (comm && fund) {
      const total = comm.remainingPrincipal + fund.remainingPrincipal;
      if (total <= 0) return 0;
      return ((comm.annualRate ?? 0) * comm.remainingPrincipal + (fund.annualRate ?? 0) * fund.remainingPrincipal) / total;
    }
  }
  return node.annualRate ?? input.annualRate;
}

// Reconstruct a sub-loan LoanPlan from the merged combined plan's stored sub-items.
function extractSubPlan(combinedPlan: LoanPlan, subType: 'commercial' | 'fund'): LoanPlan {
  const subInput = combinedPlan.input[subType];
  if (!subInput) throw new Error('组合贷参数不完整');

  const subItems = combinedPlan.schedule
    .filter((item) => item[subType] != null)
    .map((item) => item[subType]!);

  const loanInput: LoanInput = {
    loanType: subType === 'commercial' ? 'commercial' : 'fund',
    repaymentMethod: combinedPlan.input.repaymentMethod,
    amount: subInput.amount,
    years: subInput.years,
    annualRate: subInput.annualRate,
    firstPaymentDate: subItems[0]?.date || combinedPlan.input.firstPaymentDate,
  };

  return {
    input: loanInput,
    schedule: subItems,
    annualSummary: buildAnnualSummary(subItems),
    summary: {
      totalPrincipal: subInput.amount,
      totalInterest: sum(subItems.map((x) => x.interest)),
      totalPayment: roundMoney(subInput.amount + sum(subItems.map((x) => x.interest))),
      monthlyPayment: roundMoney(subItems[0]?.payment || 0),
      firstMonthPayment: roundMoney(subItems[0]?.payment || 0),
      lastMonthPayment: roundMoney(subItems[subItems.length - 1]?.payment || 0),
      totalPeriods: subItems.length,
      endDate: subItems[subItems.length - 1]?.date || combinedPlan.input.firstPaymentDate,
    },
  };
}

function mergeCombinedSchedule(
  commSchedule: PaymentScheduleItem[],
  fundSchedule: PaymentScheduleItem[],
  commFallbackPrincipal: number,
  fundFallbackPrincipal: number,
  commFallbackInterest: number,
  fundFallbackInterest: number,
): PaymentScheduleItem[] {
  const maxPeriods = Math.max(commSchedule.length, fundSchedule.length);
  const result: PaymentScheduleItem[] = [];
  for (let i = 0; i < maxPeriods; i += 1) {
    const comm = commSchedule[i];
    const fund = fundSchedule[i];
    result.push({
      period: i + 1,
      date: comm?.date || fund?.date || '',
      annualRate: (!comm || !fund) ? (comm?.annualRate ?? fund?.annualRate) : undefined,
      payment: roundMoney((comm?.payment || 0) + (fund?.payment || 0)),
      principal: roundMoney((comm?.principal || 0) + (fund?.principal || 0)),
      interest: roundMoney((comm?.interest || 0) + (fund?.interest || 0)),
      extraPrincipal: roundMoney((comm?.extraPrincipal || 0) + (fund?.extraPrincipal || 0)),
      penaltyFee: roundMoney((comm?.penaltyFee || 0) + (fund?.penaltyFee || 0)),
      remainingPrincipal: roundMoney((comm?.remainingPrincipal || 0) + (fund?.remainingPrincipal || 0)),
      totalPaidPrincipal: roundMoney(
        (comm?.totalPaidPrincipal ?? commFallbackPrincipal) +
        (fund?.totalPaidPrincipal ?? fundFallbackPrincipal),
      ),
      totalPaidInterest: roundMoney(
        (comm?.totalPaidInterest ?? commFallbackInterest) +
        (fund?.totalPaidInterest ?? fundFallbackInterest),
      ),
      commercial: comm,
      fund,
    });
  }
  return result;
}

function getRemainingInterestFromPeriod(plan: LoanPlan, startPeriod: number): number {
  return sum(plan.schedule.filter((item) => item.period > startPeriod).map((item) => item.interest));
}

function calculateCombinedPrepaymentPlan(originalPlan: LoanPlan, input: PrepaymentInput): PrepaymentResult {
  const target = input.target ?? 'commercial';
  const other = target === 'commercial' ? 'fund' : 'commercial';
  if (!originalPlan.input.commercial || !originalPlan.input.fund) throw new Error('组合贷参数不完整');

  const node = findNodeByDate(originalPlan.schedule, input.date);
  const includeCurrentMonthPayment = input.includeCurrentMonthPayment ?? true;
  const anchorPeriod = originalPlan.schedule.filter((item) =>
    includeCurrentMonthPayment ? item.period <= node.period : item.period < node.period,
  ).length;

  const targetPlan = extractSubPlan(originalPlan, target);
  const otherPlan = extractSubPlan(originalPlan, other);
  const targetResult = calculatePrepaymentPlan(targetPlan, input);
  const adjustedCommSchedule = target === 'commercial' ? targetResult.adjustedPlan.schedule : otherPlan.schedule;
  const adjustedFundSchedule = target === 'fund' ? targetResult.adjustedPlan.schedule : otherPlan.schedule;

  const mergedSchedule = mergeCombinedSchedule(
    adjustedCommSchedule,
    adjustedFundSchedule,
    originalPlan.input.commercial.amount,
    originalPlan.input.fund.amount,
    extractSubPlan(originalPlan, 'commercial').summary.totalInterest,
    extractSubPlan(originalPlan, 'fund').summary.totalInterest,
  );
  const adjustedPlan = buildLoanPlan(originalPlan.input, mergedSchedule);
  const originalRemainingInterest = getRemainingInterestFromPeriod(originalPlan, anchorPeriod);
  const adjustedRemainingInterest = getRemainingInterestFromPeriod(adjustedPlan, anchorPeriod);
  const adjustedMonthlyPayment = adjustedPlan.schedule[anchorPeriod]?.payment || 0;
  const penaltyFee = input.penaltyFee || 0;

  return {
    originalPlan,
    adjustedPlan,
    compare: {
      originalRemainingPrincipal: roundMoney(node.remainingPrincipal),
      adjustedRemainingPrincipal: roundMoney(node.remainingPrincipal - input.amount),
      originalMonthlyPayment: roundMoney(node.payment),
      adjustedMonthlyPayment: roundMoney(adjustedMonthlyPayment),
      originalRemainingPeriods: originalPlan.summary.totalPeriods - anchorPeriod,
      adjustedRemainingPeriods: Math.max(0, adjustedPlan.summary.totalPeriods - anchorPeriod),
      originalRemainingInterest,
      adjustedRemainingInterest,
      savedInterest: roundMoney(originalRemainingInterest - adjustedRemainingInterest - penaltyFee),
      originalEndDate: originalPlan.summary.endDate,
      adjustedEndDate: adjustedPlan.summary.endDate,
      penaltyFee,
    },
  };
}

function calculateScheduleByPrincipalPeriodsRate(params: {
  principal: number;
  periods: number;
  annualRate: number;
  repaymentMethod: RepaymentMethod;
  firstPaymentDate: string;
}): PaymentScheduleItem[] {
  if (params.principal <= 0 || params.periods <= 0) return [];
  const monthlyRate = getMonthlyRate(params.annualRate);

  if (params.repaymentMethod === 'equalPayment') {
    const monthlyPayment = monthlyRate === 0
      ? params.principal / params.periods
      : params.principal * monthlyRate * Math.pow(1 + monthlyRate, params.periods) / (Math.pow(1 + monthlyRate, params.periods) - 1);
    return buildEqualPaymentSchedule({ ...params, monthlyRate, monthlyPayment });
  }

  return buildEqualPrincipalSchedule({
    ...params,
    monthlyRate,
    monthlyPrincipal: params.principal / params.periods,
  });
}

function calculateScheduleByTargetPayment(params: {
  principal: number;
  targetPayment: number;
  annualRate: number;
  monthlyRate: number;
  repaymentMethod: RepaymentMethod;
  firstPaymentDate: string;
}): PaymentScheduleItem[] {
  if (params.principal <= 0) return [];

  if (params.repaymentMethod === 'equalPrincipal') {
    const monthlyPrincipal = params.targetPayment - params.principal * params.monthlyRate;
    if (monthlyPrincipal <= 0) throw new Error('当前月供不足以覆盖利息，无法计算缩短年限');
    return buildEqualPrincipalSchedule({
      principal: params.principal,
      annualRate: params.annualRate,
      monthlyRate: params.monthlyRate,
      periods: Math.ceil(params.principal / monthlyPrincipal),
      monthlyPrincipal,
      firstPaymentDate: params.firstPaymentDate,
    });
  }

  if (params.monthlyRate === 0) {
    return buildEqualPaymentSchedule({
      principal: params.principal,
      annualRate: 0,
      monthlyRate: 0,
      periods: Math.ceil(params.principal / params.targetPayment),
      monthlyPayment: params.targetPayment,
      firstPaymentDate: params.firstPaymentDate,
    });
  }

  if (params.targetPayment <= params.principal * params.monthlyRate) {
    throw new Error('当前月供不足以覆盖利息，无法计算缩短年限');
  }

  const periods = Math.ceil(
    Math.log(params.targetPayment / (params.targetPayment - params.principal * params.monthlyRate)) /
      Math.log(1 + params.monthlyRate),
  );

  return buildEqualPaymentSchedule({
    principal: params.principal,
    annualRate: params.annualRate,
    monthlyRate: params.monthlyRate,
    periods,
    monthlyPayment: params.targetPayment,
    firstPaymentDate: params.firstPaymentDate,
  });
}

function rebuildAdjustedSchedule(
  paidSchedule: PaymentScheduleItem[],
  remainingSchedule: PaymentScheduleItem[],
  adjustedRemainingPrincipal: number,
  totalPrepaidPrincipal: number,
): PaymentScheduleItem[] {
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;
  const paid = paidSchedule.map((item, index) => {
    totalPaidPrincipal = roundMoney(totalPaidPrincipal + item.principal);
    totalPaidInterest = roundMoney(totalPaidInterest + item.interest);
    return {
      ...item,
      period: index + 1,
      totalPaidPrincipal,
      totalPaidInterest,
    };
  });

  let remainingPrincipal = adjustedRemainingPrincipal;
  const remaining = remainingSchedule.map((item, index) => {
    totalPaidPrincipal = roundMoney(totalPaidPrincipal + totalPrepaidPrincipal + item.principal);
    totalPrepaidPrincipal = 0;
    totalPaidInterest = roundMoney(totalPaidInterest + item.interest);
    remainingPrincipal = roundMoney(remainingPrincipal - item.principal);
    return {
      ...item,
      period: paid.length + index + 1,
      remainingPrincipal: Math.max(0, remainingPrincipal),
      totalPaidPrincipal,
      totalPaidInterest,
    };
  });

  return [...paid, ...remaining];
}

export function calculatePrepaymentPlan(originalPlan: LoanPlan, input: PrepaymentInput): PrepaymentResult {
  if (originalPlan.input.loanType === 'combined') {
    return calculateCombinedPrepaymentPlan(originalPlan, input);
  }

  const node = findNodeByDate(originalPlan.schedule, input.date);
  const includeCurrentMonthPayment = input.includeCurrentMonthPayment ?? true;
  const paidSchedule = originalPlan.schedule.filter((item) => includeCurrentMonthPayment ? item.period <= node.period : item.period < node.period);
  const lastPaid = paidSchedule[paidSchedule.length - 1];
  const currentRemainingPrincipal = includeCurrentMonthPayment
    ? node.remainingPrincipal
    : lastPaid?.remainingPrincipal ?? originalPlan.summary.totalPrincipal;

  if (input.amount <= 0) throw new Error('提前还款金额必须大于 0');
  if (input.amount > currentRemainingPrincipal) throw new Error('提前还款金额不能超过剩余本金');

  const anchorPeriod = paidSchedule.length;
  const anchorDate = lastPaid?.date || addMonths(originalPlan.input.firstPaymentDate, -1);
  const adjustedPrincipal = roundMoney(currentRemainingPrincipal - input.amount);
  const remainingPeriods = originalPlan.summary.totalPeriods - anchorPeriod;
  const firstPaymentDate = addMonths(anchorDate, 1);
  const currentAnnualRate = getEffectiveAnnualRate(node, originalPlan.input);
  const remainingSchedule = input.mode === 'reducePayment'
    ? calculateScheduleByPrincipalPeriodsRate({
      principal: adjustedPrincipal,
      periods: remainingPeriods,
      annualRate: currentAnnualRate,
      repaymentMethod: originalPlan.input.repaymentMethod,
      firstPaymentDate,
    })
    : calculateScheduleByTargetPayment({
      principal: adjustedPrincipal,
      targetPayment: node.payment,
      annualRate: currentAnnualRate,
      monthlyRate: getMonthlyRate(currentAnnualRate),
      repaymentMethod: originalPlan.input.repaymentMethod,
      firstPaymentDate,
    });

  const adjustedSchedule = rebuildAdjustedSchedule(paidSchedule, remainingSchedule, adjustedPrincipal, input.amount);
  const adjustedPlan = buildLoanPlan(originalPlan.input, adjustedSchedule);
  const originalRemainingInterest = getRemainingInterestFromPeriod(originalPlan, anchorPeriod);
  const adjustedRemainingInterest = sum(adjustedPlan.schedule.filter((item) => item.period > anchorPeriod).map((item) => item.interest));
  const adjustedMonthlyPayment = adjustedPlan.schedule[anchorPeriod]?.payment || 0;
  const penaltyFee = input.penaltyFee || 0;

  return {
    originalPlan,
    adjustedPlan,
    compare: {
      originalRemainingPrincipal: roundMoney(currentRemainingPrincipal),
      adjustedRemainingPrincipal: adjustedPrincipal,
      originalMonthlyPayment: roundMoney(node.payment),
      adjustedMonthlyPayment: roundMoney(adjustedMonthlyPayment),
      originalRemainingPeriods: remainingPeriods,
      adjustedRemainingPeriods: Math.max(0, adjustedPlan.summary.totalPeriods - anchorPeriod),
      originalRemainingInterest,
      adjustedRemainingInterest,
      savedInterest: roundMoney(originalRemainingInterest - adjustedRemainingInterest - penaltyFee),
      originalEndDate: originalPlan.summary.endDate,
      adjustedEndDate: adjustedPlan.summary.endDate,
      penaltyFee,
    },
  };
}

export function calculatePrepaymentComparison(
  originalPlan: LoanPlan,
  input: PrepaymentComparisonInput,
): PrepaymentComparisonResult {
  const result: PrepaymentComparisonResult = {};

  try {
    result.reduceTerm = calculatePrepaymentPlan(originalPlan, {
      ...input,
      mode: 'reduceTerm',
    });
  } catch (error) {
    result.reduceTermError = error instanceof Error ? error.message : '减少年限计算失败';
  }

  try {
    result.reducePayment = calculatePrepaymentPlan(originalPlan, {
      ...input,
      mode: 'reducePayment',
    });
  } catch (error) {
    result.reducePaymentError = error instanceof Error ? error.message : '减少月供计算失败';
  }

  return result;
}

function calculateCombinedRateAdjustedPlan(originalPlan: LoanPlan, input: RateAdjustInput): RateAdjustResult {
  if (!originalPlan.input.commercial || !originalPlan.input.fund) throw new Error('组合贷参数不完整');

  const commSubPlan = extractSubPlan(originalPlan, 'commercial');
  const fundSubPlan = extractSubPlan(originalPlan, 'fund');

  const newCommRate = input.newCommercialRate ?? commSubPlan.input.annualRate;
  const newFundRate = input.newFundRate ?? fundSubPlan.input.annualRate;

  if (newCommRate < 0) throw new Error('商贷新利率不能小于 0');
  if (newFundRate < 0) throw new Error('公积金贷新利率不能小于 0');

  // Validate date against combined schedule first (throws if past end of loan)
  const node = findNodeByDate(originalPlan.schedule, input.effectiveDate);
  const includeEffective = input.includeEffectiveMonthPayment ?? false;
  const anchorPeriod = originalPlan.schedule.filter((item) =>
    includeEffective ? item.period <= node.period : item.period < node.period,
  ).length;

  let adjustedCommSchedule = commSubPlan.schedule;
  let adjustedFundSchedule = fundSubPlan.schedule;

  try {
    adjustedCommSchedule = calculateRateAdjustedPlan(commSubPlan, {
      ...input,
      newAnnualRate: newCommRate,
    }).adjustedPlan.schedule;
  } catch {
    // Sub-loan ended before effective date — keep original
  }

  try {
    adjustedFundSchedule = calculateRateAdjustedPlan(fundSubPlan, {
      ...input,
      newAnnualRate: newFundRate,
    }).adjustedPlan.schedule;
  } catch {
    // Sub-loan ended before effective date — keep original
  }

  const mergedSchedule = mergeCombinedSchedule(
    adjustedCommSchedule,
    adjustedFundSchedule,
    originalPlan.input.commercial.amount,
    originalPlan.input.fund.amount,
    commSubPlan.summary.totalInterest,
    fundSubPlan.summary.totalInterest,
  );

  const adjustedPlan = buildLoanPlan(originalPlan.input, mergedSchedule);
  const oldMonthlyPayment = originalPlan.schedule[anchorPeriod]?.payment || node.payment;
  const newMonthlyPayment = adjustedPlan.schedule[anchorPeriod]?.payment || 0;
  const oldRemainingInterest = getRemainingInterestFromPeriod(originalPlan, anchorPeriod);
  const newRemainingInterest = getRemainingInterestFromPeriod(adjustedPlan, anchorPeriod);

  return {
    originalPlan,
    adjustedPlan,
    compare: {
      oldMonthlyPayment: roundMoney(oldMonthlyPayment),
      newMonthlyPayment: roundMoney(newMonthlyPayment),
      monthlyPaymentDiff: roundMoney(newMonthlyPayment - oldMonthlyPayment),
      oldRemainingInterest,
      newRemainingInterest,
      interestDiff: roundMoney(newRemainingInterest - oldRemainingInterest),
      oldEndDate: originalPlan.summary.endDate,
      newEndDate: adjustedPlan.summary.endDate,
    },
  };
}

export function calculateRateAdjustedPlan(originalPlan: LoanPlan, input: RateAdjustInput): RateAdjustResult {
  if (originalPlan.input.loanType === 'combined') {
    return calculateCombinedRateAdjustedPlan(originalPlan, input);
  }
  if (input.newAnnualRate < 0) throw new Error('新利率不能小于 0');
  const node = findNodeByDate(originalPlan.schedule, input.effectiveDate);
  const includeEffectiveMonthPayment = input.includeEffectiveMonthPayment ?? false;
  const paidSchedule = originalPlan.schedule.filter((item) => (
    includeEffectiveMonthPayment ? item.period <= node.period : item.period < node.period
  ));
  const lastPaid = paidSchedule[paidSchedule.length - 1];
  const currentPrincipal = includeEffectiveMonthPayment
    ? node.remainingPrincipal
    : lastPaid?.remainingPrincipal ?? originalPlan.summary.totalPrincipal;
  const anchorPeriod = paidSchedule.length;
  const remainingPeriods = originalPlan.summary.totalPeriods - anchorPeriod;
  const remainingSchedule = calculateScheduleByPrincipalPeriodsRate({
    principal: currentPrincipal,
    periods: remainingPeriods,
    annualRate: input.newAnnualRate,
    repaymentMethod: originalPlan.input.repaymentMethod,
    firstPaymentDate: includeEffectiveMonthPayment ? addMonths(node.date, 1) : node.date,
  });

  const adjustedSchedule = rebuildAdjustedSchedule(paidSchedule, remainingSchedule, currentPrincipal, 0);
  const adjustedPlan = buildLoanPlan({ ...originalPlan.input, annualRate: input.newAnnualRate }, adjustedSchedule);
  const oldRemainingInterest = getRemainingInterestFromPeriod(originalPlan, anchorPeriod);
  const newRemainingInterest = sum(adjustedPlan.schedule.filter((item) => item.period > anchorPeriod).map((item) => item.interest));
  const oldMonthlyPayment = originalPlan.schedule[anchorPeriod]?.payment || node.payment;
  const newMonthlyPayment = adjustedPlan.schedule[anchorPeriod]?.payment || 0;

  return {
    originalPlan,
    adjustedPlan,
    compare: {
      oldMonthlyPayment: roundMoney(oldMonthlyPayment),
      newMonthlyPayment: roundMoney(newMonthlyPayment),
      monthlyPaymentDiff: roundMoney(newMonthlyPayment - oldMonthlyPayment),
      oldRemainingInterest,
      newRemainingInterest,
      interestDiff: roundMoney(newRemainingInterest - oldRemainingInterest),
      oldEndDate: originalPlan.summary.endDate,
      newEndDate: adjustedPlan.summary.endDate,
    },
  };
}

function calculatePaymentAmount(principal: number, periods: number, annualRate: number, repaymentMethod: RepaymentMethod): number {
  if (principal <= 0 || periods <= 0) return 0;
  const monthlyRate = getMonthlyRate(annualRate);
  if (repaymentMethod === 'equalPrincipal') {
    return principal / periods + principal * monthlyRate;
  }
  if (monthlyRate === 0) return principal / periods;
  return principal * monthlyRate * Math.pow(1 + monthlyRate, periods) / (Math.pow(1 + monthlyRate, periods) - 1);
}

function recalculatePeriodsByTargetPayment(
  principal: number,
  targetPayment: number,
  annualRate: number,
  repaymentMethod: RepaymentMethod,
): number {
  if (principal <= 0) return 0;
  const monthlyRate = getMonthlyRate(annualRate);
  if (repaymentMethod === 'equalPrincipal') {
    const monthlyPrincipal = targetPayment - principal * monthlyRate;
    if (monthlyPrincipal <= 0) throw new Error('当前月供不足以覆盖利息，无法按缩短年限继续计算');
    return Math.ceil(principal / monthlyPrincipal);
  }
  if (monthlyRate === 0) return Math.ceil(principal / targetPayment);
  if (targetPayment <= principal * monthlyRate) throw new Error('当前月供不足以覆盖利息，无法按缩短年限继续计算');
  return Math.ceil(Math.log(targetPayment / (targetPayment - principal * monthlyRate)) / Math.log(1 + monthlyRate));
}

function calculateCombinedHistoricalLoanPlan(input: LoanInput, events: HistoricalLoanEvent[]): HistoricalLoanResult {
  if (!input.commercial || !input.fund) throw new Error('组合贷参数不完整');

  const commInput: LoanInput = {
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

  // Events without explicit target default to commercial for backward compatibility
  const commEvents = events.filter((e) => !e.target || e.target === 'commercial');
  const fundEvents = events.filter((e) => e.target === 'fund');

  const commResult = calculateHistoricalLoanPlan(commInput, commEvents);
  const fundResult = calculateHistoricalLoanPlan(fundInput, fundEvents);

  const mergedSchedule = mergeCombinedSchedule(
    commResult.adjustedPlan.schedule,
    fundResult.adjustedPlan.schedule,
    input.commercial.amount,
    input.fund.amount,
    commResult.basePlan.summary.totalInterest,
    fundResult.basePlan.summary.totalInterest,
  );

  const basePlan = calculateCombinedLoanPlan(input);
  const adjustedPlan = buildLoanPlan(input, mergedSchedule);
  const totalExtraPrincipal = roundMoney(commResult.totalExtraPrincipal + fundResult.totalExtraPrincipal);
  const totalPenaltyFee = roundMoney(commResult.totalPenaltyFee + fundResult.totalPenaltyFee);
  const savedInterest = roundMoney(basePlan.summary.totalInterest - adjustedPlan.summary.totalInterest - totalPenaltyFee);

  return {
    basePlan,
    adjustedPlan,
    events: [...events].sort((a, b) => a.date.localeCompare(b.date)),
    rateSegments: buildRateSegmentSummary(adjustedPlan.schedule),
    totalExtraPrincipal,
    totalPenaltyFee,
    savedInterest,
    actualCashOut: roundMoney(adjustedPlan.summary.totalPayment + totalPenaltyFee),
  };
}

export function calculateHistoricalLoanPlan(input: LoanInput, events: HistoricalLoanEvent[]): HistoricalLoanResult {
  if (input.loanType === 'combined') {
    return calculateCombinedHistoricalLoanPlan(input, events);
  }

  validateLoanInput(input);

  const basePlan = calculateMortgagePlan(input);
  const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const eventsByMonth = new Map<string, HistoricalLoanEvent[]>();
  sortedEvents.forEach((event) => {
    const list = eventsByMonth.get(getMonthKey(event.date)) || [];
    list.push(event);
    eventsByMonth.set(getMonthKey(event.date), list);
  });

  let currentPrincipal = input.amount;
  let remainingPeriods = getPeriods(input.years);
  let currentAnnualRate = input.annualRate;
  let currentDate = input.firstPaymentDate;
  let totalPaidPrincipal = 0;
  let totalPaidInterest = 0;
  let totalExtraPrincipal = 0;
  let totalPenaltyFee = 0;
  let targetPayment = calculatePaymentAmount(currentPrincipal, remainingPeriods, currentAnnualRate, input.repaymentMethod);
  const schedule: PaymentScheduleItem[] = [];

  while (remainingPeriods > 0 && currentPrincipal > 0) {
    const monthEvents = eventsByMonth.get(getMonthKey(currentDate)) || [];
    let pendingRatePenalty = 0;
    monthEvents
      .filter((event): event is Extract<HistoricalLoanEvent, { type: 'rateChange' }> => event.type === 'rateChange')
      .forEach((event) => {
        if (event.annualRate < 0) throw new Error('历史利率不能小于 0');
        currentAnnualRate = event.annualRate;
        targetPayment = calculatePaymentAmount(currentPrincipal, remainingPeriods, currentAnnualRate, input.repaymentMethod);
        pendingRatePenalty = roundMoney(pendingRatePenalty + (event.penaltyFee || 0));
        totalPenaltyFee = roundMoney(totalPenaltyFee + (event.penaltyFee || 0));
      });

    const monthlyRate = getMonthlyRate(currentAnnualRate);
    const interest = roundMoney(currentPrincipal * monthlyRate);
    let principal = input.repaymentMethod === 'equalPrincipal'
      ? currentPrincipal / remainingPeriods
      : targetPayment - interest;
    if (principal > currentPrincipal || remainingPeriods === 1) principal = currentPrincipal;

    const payment = roundMoney(principal + interest);
    currentPrincipal = roundMoney(currentPrincipal - principal);
    remainingPeriods -= 1;
    totalPaidPrincipal = roundMoney(totalPaidPrincipal + principal);
    totalPaidInterest = roundMoney(totalPaidInterest + interest);

    let extraPrincipal = 0;
    let penaltyFee = pendingRatePenalty;

    monthEvents
      .filter((event): event is Extract<HistoricalLoanEvent, { type: 'prepayment' }> => event.type === 'prepayment')
      .forEach((event) => {
        if (event.amount <= 0) throw new Error('历史提前还款金额必须大于 0');
        if (event.amount > currentPrincipal) throw new Error('历史提前还款金额不能超过当期剩余本金');
        currentPrincipal = roundMoney(currentPrincipal - event.amount);
        extraPrincipal = roundMoney(extraPrincipal + event.amount);
        penaltyFee = roundMoney(penaltyFee + (event.penaltyFee || 0));
        totalExtraPrincipal = roundMoney(totalExtraPrincipal + event.amount);
        totalPenaltyFee = roundMoney(totalPenaltyFee + (event.penaltyFee || 0));
        totalPaidPrincipal = roundMoney(totalPaidPrincipal + event.amount);

        if (event.mode === 'reduceTerm') {
          remainingPeriods = recalculatePeriodsByTargetPayment(currentPrincipal, targetPayment, currentAnnualRate, input.repaymentMethod);
        } else {
          targetPayment = calculatePaymentAmount(currentPrincipal, remainingPeriods, currentAnnualRate, input.repaymentMethod);
        }
      });

    schedule.push({
      period: schedule.length + 1,
      date: currentDate,
      annualRate: currentAnnualRate,
      payment,
      principal: roundMoney(principal),
      interest,
      extraPrincipal,
      penaltyFee,
      remainingPrincipal: Math.max(0, currentPrincipal),
      totalPaidPrincipal,
      totalPaidInterest,
    });

    if (currentPrincipal <= 0) break;
    currentDate = addMonths(currentDate, 1);
  }

  const adjustedPlan = buildLoanPlan(input, schedule);
  const savedInterest = roundMoney(basePlan.summary.totalInterest - adjustedPlan.summary.totalInterest - totalPenaltyFee);

  return {
    basePlan,
    adjustedPlan,
    events: sortedEvents,
    rateSegments: buildRateSegmentSummary(adjustedPlan.schedule),
    totalExtraPrincipal,
    totalPenaltyFee,
    savedInterest,
    actualCashOut: roundMoney(adjustedPlan.summary.totalPayment + totalPenaltyFee),
  };
}

export function buildRateSegmentSummary(schedule: PaymentScheduleItem[]): RateSegmentSummary[] {
  if (schedule.some((item) => item.commercial || item.fund)) {
    return (['commercial', 'fund'] as const)
      .flatMap((loanPart) => buildRateSegmentSummary(
        schedule
          .filter((item) => item[loanPart] != null)
          .map((item) => ({ ...item[loanPart]!, period: item.period, date: item.date, loanPart })),
      ).map((segment) => ({
        ...segment,
        loanPart,
        commercialRate: loanPart === 'commercial' ? segment.annualRate : undefined,
        fundRate: loanPart === 'fund' ? segment.annualRate : undefined,
      })))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.loanPart || '').localeCompare(b.loanPart || ''));
  }

  const segments: RateSegmentSummary[] = [];
  let currentKey = '';

  schedule.forEach((item) => {
    const annualRate = item.annualRate ?? 0;
    const key = `${item.loanPart ?? ''}_${annualRate}`;

    const current = segments[segments.length - 1];
    if (!current || currentKey !== key) {
      currentKey = key;
      segments.push({
        ...(item.loanPart ? { loanPart: item.loanPart } : {}),
        startDate: item.date,
        endDate: item.date,
        annualRate,
        periods: 1,
        totalPayment: roundMoney(item.payment),
        totalPrincipal: roundMoney(item.principal),
        totalInterest: roundMoney(item.interest),
        totalExtraPrincipal: roundMoney(item.extraPrincipal || 0),
        totalPenaltyFee: roundMoney(item.penaltyFee || 0),
        endRemainingPrincipal: item.remainingPrincipal,
      });
      return;
    }

    current.endDate = item.date;
    current.periods += 1;
    current.totalPayment = roundMoney(current.totalPayment + item.payment);
    current.totalPrincipal = roundMoney(current.totalPrincipal + item.principal);
    current.totalInterest = roundMoney(current.totalInterest + item.interest);
    current.totalExtraPrincipal = roundMoney(current.totalExtraPrincipal + (item.extraPrincipal || 0));
    current.totalPenaltyFee = roundMoney(current.totalPenaltyFee + (item.penaltyFee || 0));
    current.endRemainingPrincipal = item.remainingPrincipal;
  });

  return segments;
}

export function calculateBudgetReverse(input: BudgetReverseInput): BudgetReverseResult {
  const monthlyPayment = Number(input.affordableMonthlyPayment || 0);
  const periods = getPeriods(input.years);
  const monthlyRate = getMonthlyRate(input.annualRate);

  if (monthlyPayment <= 0) throw new Error('可承受月供必须大于 0');
  if (periods <= 0) throw new Error('请选择贷款年限');
  if (input.downPaymentRatio < 0 || input.downPaymentRatio >= 100) throw new Error('首付比例必须在 0 到 100 之间');

  const loanAmount = monthlyRate === 0
    ? monthlyPayment * periods
    : monthlyPayment * (Math.pow(1 + monthlyRate, periods) - 1) / (monthlyRate * Math.pow(1 + monthlyRate, periods));
  const loanRatio = 1 - input.downPaymentRatio / 100;
  const totalHousePrice = loanAmount / loanRatio;
  const downPaymentAmount = totalHousePrice - loanAmount;
  const totalPayment = monthlyPayment * periods;

  return {
    loanAmount: roundMoney(loanAmount),
    totalHousePrice: roundMoney(totalHousePrice),
    downPaymentAmount: roundMoney(downPaymentAmount),
    totalInterest: roundMoney(totalPayment - loanAmount),
    totalPayment: roundMoney(totalPayment),
  };
}

export function getPressureLevel(monthlyPayment: number, familyMonthlyIncome: number): {
  ratio: number;
  level: 'low' | 'medium' | 'high' | 'danger';
  text: string;
} {
  if (familyMonthlyIncome <= 0) throw new Error('家庭月收入必须大于 0');
  const ratio = monthlyPayment / familyMonthlyIncome * 100;
  if (ratio <= 30) return { ratio: roundMoney(ratio), level: 'low', text: '压力较低' };
  if (ratio <= 40) return { ratio: roundMoney(ratio), level: 'medium', text: '压力适中' };
  if (ratio <= 50) return { ratio: roundMoney(ratio), level: 'high', text: '压力偏高' };
  return { ratio: roundMoney(ratio), level: 'danger', text: '风险较高' };
}
