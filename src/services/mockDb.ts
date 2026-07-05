import { Customer, Trade, Portfolio, CustomerNote, CustomerTimelineEvent } from '../types';

export const mockCustomers: Customer[] = [
  {
    id: 'c1',
    companyName: 'Customer A',
    customerNumber: 'CUST-001',
    taxNumber: '1111111111',
    branch: 'Merkez',
    portfolioManager: 'PM User 1',
    relationshipManager: 'RM User 1',
    riskLimit: null,
    customerSegment: 'Kurumsal',
    notes: 'Initial customer for layout testing.',
    createdDate: '2026-01-10T10:00:00Z',
    updatedDate: '2026-07-01T10:00:00Z',
    status: 'Active',
  },
  {
    id: 'c2',
    companyName: 'Customer B',
    customerNumber: 'CUST-002',
    taxNumber: '2222222222',
    branch: 'Şube 1',
    portfolioManager: 'PM User 2',
    relationshipManager: 'RM User 2',
    riskLimit: null,
    customerSegment: 'Ticari',
    notes: '',
    createdDate: '2026-02-15T10:00:00Z',
    updatedDate: '2026-07-02T10:00:00Z',
    status: 'Active',
  }
];

export const mockTrades: Trade[] = [];
export const mockPortfolios: Record<string, Portfolio> = {};
export const mockNotes: CustomerNote[] = [];
export const mockTimeline: CustomerTimelineEvent[] = [];

// Simulated DB Client Architecture
export const db = {
  customers: {
    findMany: async (): Promise<Customer[]> => {
      return [...mockCustomers];
    },
    findById: async (id: string): Promise<Customer | null> => {
      return mockCustomers.find(c => c.id === id) || null;
    },
    create: async (data: Omit<Customer, 'id' | 'createdDate' | 'updatedDate'>): Promise<Customer> => {
      const newCustomer: Customer = {
        ...data,
        id: 'c' + Date.now(),
        createdDate: new Date().toISOString(),
        updatedDate: new Date().toISOString(),
      };
      mockCustomers.push(newCustomer);
      return newCustomer;
    }
  },
  trades: {
    findMany: async (): Promise<Trade[]> => {
      return [...mockTrades];
    },
    findByCustomerId: async (customerId: string): Promise<Trade[]> => {
      return mockTrades.filter(t => t.customerId === customerId);
    },
    create: async (data: Omit<Trade, 'id'>): Promise<Trade> => {
      const newTrade: Trade = { ...data, id: 't' + Date.now() };
      mockTrades.push(newTrade);
      return newTrade;
    }
  },
  portfolio: {
    findByCustomerId: async (customerId: string): Promise<Portfolio> => {
      if (!mockPortfolios[customerId]) {
        // Prepare portfolio template with null values for financial metrics as requested.
        mockPortfolios[customerId] = {
          customerId,
          totalOpenPositions: mockTrades.filter(t => t.customerId === customerId && t.status === 'Open').length,
          usdNotional: null,
          currentMtm: null,
          totalProfit: null,
          totalLoss: null,
          requiredMargin: null,
          availableMargin: null,
          excessMargin: null,
          missingMargin: null,
          marginUtilization: null,
          delta: null, gamma: null, vega: null, theta: null,
          riskLevel: null
        };
      }
      return mockPortfolios[customerId];
    }
  }
};
