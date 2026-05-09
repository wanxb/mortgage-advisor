import { describe, expect, it } from 'vitest';
import {
  calculateBudgetReverse,
  buildRateSegmentSummary,
  calculateHistoricalLoanPlan,
  calculateMortgagePlan,
  calculatePrepaymentComparison,
  calculatePrepaymentPlan,
  calculateRateAdjustedPlan,
} from './mortgageCalculator';
import type { LoanInput } from '../types/mortgage';

const baseInput: LoanInput = {
  loanType: 'commercial',
  repaymentMethod: 'equalPayment',
  amount: 1_000_000,
  years: 30,
  annualRate: 3.5,
  firstPaymentDate: '2026-06-01',
};

describe('mortgage calculator', () => {
  it('generates a 360 period equal-payment plan for commercial and fund loans', () => {
    const commercial = calculateMortgagePlan(baseInput);
    const fund = calculateMortgagePlan({ ...baseInput, loanType: 'fund' });

    expect(commercial.schedule).toHaveLength(360);
    expect(fund.schedule).toHaveLength(360);
    expect(commercial.summary.totalPrincipal).toBe(1_000_000);
    expect(commercial.schedule[commercial.schedule.length - 1].remainingPrincipal).toBe(0);
  });

  it('keeps entered rate precision in monthly details', () => {
    const plan = calculateMortgagePlan({ ...baseInput, annualRate: 5.145 });

    expect(plan.schedule[0].annualRate).toBe(5.145);
  });

  it('generates a descending equal-principal plan', () => {
    const plan = calculateMortgagePlan({ ...baseInput, repaymentMethod: 'equalPrincipal' });

    expect(plan.schedule[0].payment).toBeGreaterThan(plan.schedule[1].payment);
    expect(plan.summary.monthlyDecrease).toBeGreaterThan(0);
    expect(plan.schedule[plan.schedule.length - 1].remainingPrincipal).toBe(0);
  });

  it('combines commercial and fund loan schedules by month', () => {
    const combined = calculateMortgagePlan({
      ...baseInput,
      loanType: 'combined',
      amount: 0,
      commercial: { amount: 700_000, years: 30, annualRate: 3.7 },
      fund: { amount: 300_000, years: 30, annualRate: 2.85 },
    });
    const commercial = calculateMortgagePlan({ ...baseInput, amount: 700_000, annualRate: 3.7 });
    const fund = calculateMortgagePlan({ ...baseInput, loanType: 'fund', amount: 300_000, annualRate: 2.85 });

    expect(combined.schedule[0].payment).toBeCloseTo(commercial.schedule[0].payment + fund.schedule[0].payment, 2);
    expect(combined.summary.totalPrincipal).toBe(1_000_000);
    expect(combined.schedule).toHaveLength(360);
  });

  it('supports zero interest loans', () => {
    const plan = calculateMortgagePlan({ ...baseInput, years: 10, annualRate: 0 });

    expect(plan.schedule).toHaveLength(120);
    expect(plan.summary.totalInterest).toBe(0);
    expect(plan.schedule[0].principal).toBeCloseTo(8_333.33, 2);
  });

  it('reduces monthly payment after prepayment while keeping term', () => {
    const plan = calculateMortgagePlan(baseInput);
    const result = calculatePrepaymentPlan(plan, {
      date: '2028-06-01',
      amount: 100_000,
      mode: 'reducePayment',
      includeCurrentMonthPayment: true,
    });

    expect(result.compare.adjustedRemainingPeriods).toBe(result.compare.originalRemainingPeriods);
    expect(result.compare.adjustedMonthlyPayment).toBeLessThan(result.compare.originalMonthlyPayment);
  });

  it('reduces remaining periods after prepayment while preserving payment target', () => {
    const plan = calculateMortgagePlan(baseInput);
    const result = calculatePrepaymentPlan(plan, {
      date: '2028-06-01',
      amount: 100_000,
      mode: 'reduceTerm',
      includeCurrentMonthPayment: true,
    });

    expect(result.compare.adjustedRemainingPeriods).toBeLessThan(result.compare.originalRemainingPeriods);
    expect(result.compare.savedInterest).toBeGreaterThan(0);
  });

  it('lowers payment and interest after rate reduction', () => {
    const plan = calculateMortgagePlan(baseInput);
    const result = calculateRateAdjustedPlan(plan, {
      effectiveDate: '2028-06-01',
      newAnnualRate: 3,
    });

    expect(result.compare.newMonthlyPayment).toBeLessThan(result.compare.oldMonthlyPayment);
    expect(result.compare.interestDiff).toBeLessThan(0);
  });

  it('reverses budget from affordable monthly payment', () => {
    const result = calculateBudgetReverse({
      affordableMonthlyPayment: 4_000,
      years: 30,
      annualRate: 3.5,
      downPaymentRatio: 30,
    });

    expect(result.loanAmount).toBeGreaterThan(0);
    expect(result.totalHousePrice).toBeGreaterThan(result.loanAmount);
    expect(result.downPaymentAmount).toBeCloseTo(result.totalHousePrice * 0.3, 1);
  });

  it('applies multiple historical rate changes and prepayments with penalties', () => {
    const result = calculateHistoricalLoanPlan(baseInput, [
      { id: 'rate-1', type: 'rateChange', date: '2027-01-01', annualRate: 3.2 },
      { id: 'prepay-1', type: 'prepayment', date: '2028-06-01', amount: 80_000, mode: 'reduceTerm', penaltyFee: 1_000 },
      { id: 'rate-2', type: 'rateChange', date: '2029-01-01', annualRate: 3 },
      { id: 'prepay-2', type: 'prepayment', date: '2030-06-01', amount: 50_000, mode: 'reducePayment', penaltyFee: 500 },
    ]);

    expect(result.totalExtraPrincipal).toBe(130_000);
    expect(result.totalPenaltyFee).toBe(1_500);
    expect(result.adjustedPlan.summary.totalPeriods).toBeLessThan(result.basePlan.summary.totalPeriods);
    expect(result.savedInterest).toBeGreaterThan(0);
    expect(result.adjustedPlan.schedule.some((item) => item.extraPrincipal === 80_000 && item.penaltyFee === 1_000)).toBe(true);
    expect(result.adjustedPlan.schedule.some((item) => item.annualRate === 3)).toBe(true);
    expect(result.rateSegments.length).toBeGreaterThan(1);
    expect(result.rateSegments.some((segment) => segment.totalExtraPrincipal > 0 && segment.totalPenaltyFee > 0)).toBe(true);
    expect(result.rateSegments.map((segment) => segment.totalInterest).reduce((sum, value) => sum + value, 0)).toBeCloseTo(result.adjustedPlan.summary.totalInterest, 1);
  });

  it('keeps historical rate precision without rounding to two decimals', () => {
    const result = calculateHistoricalLoanPlan(baseInput, [
      { id: 'rate-precision', type: 'rateChange', date: '2027-01-01', annualRate: 4.995 },
    ]);

    expect(result.adjustedPlan.schedule.find((item) => item.date === '2027-01-01')?.annualRate).toBe(4.995);
    expect(result.rateSegments.some((segment) => segment.annualRate === 4.995)).toBe(true);
  });

  it('builds rate segment summaries from monthly details', () => {
    const result = calculateHistoricalLoanPlan(baseInput, [
      { id: 'rate-1', type: 'rateChange', date: '2027-01-01', annualRate: 3.2 },
      { id: 'rate-2', type: 'rateChange', date: '2028-01-01', annualRate: 3 },
    ]);
    const segments = buildRateSegmentSummary(result.adjustedPlan.schedule);

    expect(segments).toHaveLength(3);
    expect(segments[0].annualRate).toBe(3.5);
    expect(segments[1].annualRate).toBe(3.2);
    expect(segments[2].annualRate).toBe(3);
    expect(segments.reduce((count, segment) => count + segment.periods, 0)).toBe(result.adjustedPlan.schedule.length);
  });

  it('calculates both prepayment modes at once', () => {
    const plan = calculateMortgagePlan(baseInput);
    const result = calculatePrepaymentComparison(plan, {
      date: '2028-06-01',
      amount: 100_000,
      includeCurrentMonthPayment: true,
      penaltyFee: 0,
    });

    expect(result.reduceTerm).toBeDefined();
    expect(result.reducePayment).toBeDefined();
    expect(result.reduceTerm?.compare.adjustedRemainingPeriods).toBeLessThan(result.reducePayment?.compare.adjustedRemainingPeriods || 0);
    expect(result.reducePayment?.compare.adjustedMonthlyPayment).toBeLessThan(result.reducePayment?.compare.originalMonthlyPayment || 0);
  });
});
