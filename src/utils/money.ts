export function roundMoney(value: number): number {
  return Number(Number(value || 0).toFixed(2));
}

export function sum(values: number[]): number {
  return roundMoney(values.reduce((acc, item) => acc + Number(item || 0), 0));
}

export function wanToYuan(value: number): number {
  return roundMoney(Number(value || 0) * 10000);
}

export function yuanToWan(value: number): number {
  return roundMoney(Number(value || 0) / 10000);
}

export function formatMoney(value: number, options?: { unit?: 'yuan' | 'wan'; decimals?: number }): string {
  const unit = options?.unit || 'yuan';
  const decimals = options?.decimals ?? (unit === 'wan' ? 2 : 0);

  if (unit === 'wan') {
    return `${(Number(value || 0) / 10000).toLocaleString('zh-CN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })} 万元`;
  }

  return `${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} 元`;
}
