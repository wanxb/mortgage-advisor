export type LoanType = 'commercial' | 'fund' | 'combined';
export type RepaymentMethod = 'equalPayment' | 'equalPrincipal';
export type PrepaymentMode = 'reduceTerm' | 'reducePayment';

export interface SubLoanInput {
  amount: number;
  years: number;
  annualRate: number;
}

export interface LoanInput {
  loanType: LoanType;
  repaymentMethod: RepaymentMethod;
  amount: number;
  years: number;
  annualRate: number;
  firstPaymentDate: string;
  commercial?: SubLoanInput;
  fund?: SubLoanInput;
}

export interface PaymentScheduleItem {
  period: number;
  date: string;
  annualRate?: number;
  payment: number;
  principal: number;
  interest: number;
  extraPrincipal?: number;
  penaltyFee?: number;
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
  date: string;
  amount: number;
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
  effectiveDate: string;
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

export interface RateSegmentSummary {
  startDate: string;
  endDate: string;
  annualRate: number;
  periods: number;
  totalPayment: number;
  totalPrincipal: number;
  totalInterest: number;
  totalExtraPrincipal: number;
  totalPenaltyFee: number;
  endRemainingPrincipal: number;
}

export type HistoricalEventType = 'rateChange' | 'prepayment';

export interface HistoricalRateChangeEvent {
  id: string;
  type: 'rateChange';
  date: string;
  annualRate: number;
  penaltyFee?: number;
}

export interface HistoricalPrepaymentEvent {
  id: string;
  type: 'prepayment';
  date: string;
  amount: number;
  mode: PrepaymentMode;
  penaltyFee?: number;
}

export type HistoricalLoanEvent = HistoricalRateChangeEvent | HistoricalPrepaymentEvent;

export interface HistoricalLoanResult {
  basePlan: LoanPlan;
  adjustedPlan: LoanPlan;
  events: HistoricalLoanEvent[];
  rateSegments: RateSegmentSummary[];
  totalExtraPrincipal: number;
  totalPenaltyFee: number;
  savedInterest: number;
  actualCashOut: number;
}

export interface PrepaymentComparisonInput {
  date: string;
  amount: number;
  includeCurrentMonthPayment?: boolean;
  penaltyFee?: number;
}

export interface PrepaymentComparisonResult {
  reduceTerm?: PrepaymentResult;
  reducePayment?: PrepaymentResult;
  reduceTermError?: string;
  reducePaymentError?: string;
}

export interface BudgetReverseInput {
  affordableMonthlyPayment: number;
  years: number;
  annualRate: number;
  downPaymentRatio: number;
}

export interface BudgetReverseResult {
  loanAmount: number;
  totalHousePrice: number;
  downPaymentAmount: number;
  totalInterest: number;
  totalPayment: number;
}
