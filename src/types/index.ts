export interface Customer {
  id: string;
  companyName: string;
  customerNumber: string;
  taxNumber: string;
  branch: string;
  portfolioManager: string;
  relationshipManager: string;
  riskLimit: number | null;
  customerSegment: string;
  notes: string;
  createdDate: string;
  updatedDate: string;
  status: 'Active' | 'Passive';
}

export interface Trade {
  id: string;
  customerId: string;
  tradeDate: string;
  expiryDate: string;
  underlying: string;
  type: 'Call' | 'Put';
  position: 'Long' | 'Short';
  spot: number;
  strike: number;
  volatility: number;
  contractSize: number;
  premium: number;
  currentPremium: number | null;
  mtm: number | null;
  pnl: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  status: 'Open' | 'Near Expiry' | 'Expired' | 'Closed';
}

export interface Portfolio {
  customerId: string;
  totalOpenPositions: number;
  usdNotional: number | null;
  currentMtm: number | null;
  totalProfit: number | null;
  totalLoss: number | null;
  requiredMargin: number | null;
  availableMargin: number | null;
  excessMargin: number | null;
  missingMargin: number | null;
  marginUtilization: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical' | null;
}

export interface CustomerNote {
  id: string;
  customerId: string;
  date: string;
  user: string;
  text: string;
}

export interface CustomerTimelineEvent {
  id: string;
  customerId: string;
  date: string;
  type: 'Customer Created' | 'Trade Added' | 'Trade Closed' | 'Margin Updated' | 'Report Generated' | 'Other';
  description: string;
}

export type AuthRole = 'Admin' | 'Treasury Dealer' | 'Treasury Sales' | 'Branch Manager' | 'Risk Manager' | 'Viewer';

export interface User {
  id: string;
  name: string;
  role: AuthRole;
  branch?: string;
}
