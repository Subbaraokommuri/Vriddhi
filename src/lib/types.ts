export interface Fund {
  id: string;
  name: string;
  isin: string;
  scheme_code: string;
  amfi_code: string;
  category: string;
}

export interface Folio {
  id: string;
  folio_number: string;
  fund_id: string;
  fund_name: string;
  category: string;
  currentUnits: number;
  investedAmount: number;
  currentValue: number;
  nav: number;
  xirr: number | null;
}

export interface Portfolio {
  id: string;
  name: string;
  description: string;
  color: string;
  folios: Folio[];
  xirr: number | null;
  currentValue: number;
  investedAmount: number;
}

export interface Transaction {
  id: string;
  folio_id: string;
  folio_number: string;
  fund_name: string;
  date: string;
  transaction_type: 'buy' | 'sell' | 'dividend';
  amount: number;
  units: number;
  nav: number;
  balance_units: number;
}

export interface Summary {
  totalInvested: number;
  currentValue: number;
  gain: number;
  xirr: number | null;
  yearlyInvested: number;
}
