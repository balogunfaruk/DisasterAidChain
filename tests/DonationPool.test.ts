import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Campaign {
  name: string;
  description: string;
  totalFunds: number;
  active: boolean;
  createdAt: number;
  creator: string;
}

interface Refund {
  amount: number;
  requested: boolean;
  approved: boolean;
}

interface ContractState {
  paused: boolean;
  admin: string;
  campaignCounter: number;
  campaigns: Map<number, Campaign>;
  donorContributions: Map<string, number>; // Key: `${donor}-${campaignId}`
  refunds: Map<string, Refund>; // Key: `${donor}-${campaignId}`
}

class DonationPoolMock {
  private state: ContractState = {
    paused: false,
    admin: "deployer",
    campaignCounter: 0,
    campaigns: new Map(),
    donorContributions: new Map(),
    refunds: new Map(),
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_AMOUNT = 101;
  private ERR_CAMPAIGN_NOT_FOUND = 102;
  private ERR_CAMPAIGN_EXISTS = 103;
  private ERR_REFUND_NOT_ALLOWED = 104;
  private ERR_INSUFFICIENT_FUNDS = 105;
  private ERR_PAUSED = 106;
  private ERR_INVALID_CAMPAIGN_NAME = 107;
  private MAX_CAMPAIGN_NAME_LEN = 50;

  private getContributionKey(donor: string, campaignId: number): string {
    return `${donor}-${campaignId}`;
  }

  createCampaign(caller: string, name: string, description: string): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (name.length > this.MAX_CAMPAIGN_NAME_LEN) {
      return { ok: false, value: this.ERR_INVALID_CAMPAIGN_NAME };
    }
    const campaignId = this.state.campaignCounter + 1;
    if (this.state.campaigns.has(campaignId)) {
      return { ok: false, value: this.ERR_CAMPAIGN_EXISTS };
    }
    this.state.campaigns.set(campaignId, {
      name,
      description,
      totalFunds: 0,
      active: true,
      createdAt: Date.now(),
      creator: caller,
    });
    this.state.campaignCounter = campaignId;
    return { ok: true, value: campaignId };
  }

  donate(caller: string, campaignId: number, amount: number): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (!this.state.campaigns.has(campaignId)) {
      return { ok: false, value: this.ERR_CAMPAIGN_NOT_FOUND };
    }
    const campaign = this.state.campaigns.get(campaignId)!;
    campaign.totalFunds += amount;
    const key = this.getContributionKey(caller, campaignId);
    const current = this.state.donorContributions.get(key) ?? 0;
    this.state.donorContributions.set(key, current + amount);
    return { ok: true, value: amount };
  }

  requestRefund(caller: string, campaignId: number, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (!this.state.campaigns.has(campaignId)) {
      return { ok: false, value: this.ERR_CAMPAIGN_NOT_FOUND };
    }
    const key = this.getContributionKey(caller, campaignId);
    const contribution = this.state.donorContributions.get(key) ?? 0;
    if (contribution < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_FUNDS };
    }
    const campaign = this.state.campaigns.get(campaignId)!;
    if (campaign.active) {
      return { ok: false, value: this.ERR_REFUND_NOT_ALLOWED };
    }
    const refundKey = this.getContributionKey(caller, campaignId);
    this.state.refunds.set(refundKey, { amount, requested: true, approved: false });
    return { ok: true, value: true };
  }

  approveRefund(caller: string, donor: string, campaignId: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const key = this.getContributionKey(donor, campaignId);
    const refund = this.state.refunds.get(key);
    if (!refund || !refund.requested) {
      return { ok: false, value: this.ERR_REFUND_NOT_ALLOWED };
    }
    if (!this.state.campaigns.has(campaignId)) {
      return { ok: false, value: this.ERR_CAMPAIGN_NOT_FOUND };
    }
    const campaign = this.state.campaigns.get(campaignId)!;
    if (campaign.totalFunds < refund.amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_FUNDS };
    }
    campaign.totalFunds -= refund.amount;
    this.state.refunds.set(key, { ...refund, approved: true });
    return { ok: true, value: true };
  }

  withdrawFunds(caller: string, campaignId: number, amount: number, recipient: string): ClarityResponse<number> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (!this.state.campaigns.has(campaignId)) {
      return { ok: false, value: this.ERR_CAMPAIGN_NOT_FOUND };
    }
    const campaign = this.state.campaigns.get(campaignId)!;
    if (campaign.totalFunds < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_FUNDS };
    }
    campaign.totalFunds -= amount;
    // Simulate transfer to recipient by updating their balance (mocking stx-transfer?)
    const recipientKey = this.getContributionKey(recipient, campaignId);
    const recipientBalance = this.state.donorContributions.get(recipientKey) ?? 0;
    this.state.donorContributions.set(recipientKey, recipientBalance + amount);
    return { ok: true, value: amount };
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  pause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  deactivateCampaign(caller: string, campaignId: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (!this.state.campaigns.has(campaignId)) {
      return { ok: false, value: this.ERR_CAMPAIGN_NOT_FOUND };
    }
    const campaign = this.state.campaigns.get(campaignId)!;
    campaign.active = false;
    return { ok: true, value: true };
  }

  getTotalFunds(campaignId: number): ClarityResponse<number> {
    if (!this.state.campaigns.has(campaignId)) {
      return { ok: false, value: this.ERR_CAMPAIGN_NOT_FOUND };
    }
    return { ok: true, value: this.state.campaigns.get(campaignId)!.totalFunds };
  }

  getDonorContribution(donor: string, campaignId: number): ClarityResponse<number> {
    const key = this.getContributionKey(donor, campaignId);
    return { ok: true, value: this.state.donorContributions.get(key) ?? 0 };
  }

  getCampaignDetails(campaignId: number): ClarityResponse<Campaign | null> {
    return { ok: true, value: this.state.campaigns.get(campaignId) ?? null };
  }

  getRefundStatus(donor: string, campaignId: number): ClarityResponse<Refund | null> {
    const key = this.getContributionKey(donor, campaignId);
    return { ok: true, value: this.state.refunds.get(key) ?? null };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getAdmin(): ClarityResponse<string> {
    return { ok: true, value: this.state.admin };
  }

  getCampaignCount(): ClarityResponse<number> {
    return { ok: true, value: this.state.campaignCounter };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  donor1: "wallet_1",
  donor2: "wallet_2",
  recipient: "wallet_3",
};

describe("DonationPool Contract", () => {
  let contract: DonationPoolMock;

  beforeEach(() => {
    contract = new DonationPoolMock();
  });

  it("should allow creating a campaign", () => {
    const result = contract.createCampaign(accounts.deployer, "Hurricane Relief", "Aid for hurricane victims");
    expect(result).toEqual({ ok: true, value: 1 });
    const details = contract.getCampaignDetails(1);
    expect(details.ok).toBe(true);
    if (details.value && typeof details.value !== "number") {
      expect(details.value.name).toBe("Hurricane Relief");
    } else {
      expect.fail("Campaign details should be a Campaign object");
    }
  });

  it("should prevent creating campaign with invalid name length", () => {
    const longName = "a".repeat(51);
    const result = contract.createCampaign(accounts.deployer, longName, "Description");
    expect(result).toEqual({ ok: false, value: 107 });
  });

  it("should allow donating to a campaign", () => {
    contract.createCampaign(accounts.deployer, "Earthquake Aid", "Aid for earthquake");
    const donateResult = contract.donate(accounts.donor1, 1, 1000);
    expect(donateResult).toEqual({ ok: true, value: 1000 });
    const totalFunds = contract.getTotalFunds(1);
    expect(totalFunds).toEqual({ ok: true, value: 1000 });
    const contribution = contract.getDonorContribution(accounts.donor1, 1);
    expect(contribution).toEqual({ ok: true, value: 1000 });
  });

  it("should prevent donating invalid amount", () => {
    contract.createCampaign(accounts.deployer, "Test", "Test");
    const donateResult = contract.donate(accounts.donor1, 1, 0);
    expect(donateResult).toEqual({ ok: false, value: 101 });
  });

  it("should allow requesting refund when campaign inactive", () => {
    contract.createCampaign(accounts.deployer, "Test", "Test");
    contract.donate(accounts.donor1, 1, 500);
    contract.deactivateCampaign(accounts.deployer, 1);
    const requestResult = contract.requestRefund(accounts.donor1, 1, 300);
    expect(requestResult).toEqual({ ok: true, value: true });
    const status = contract.getRefundStatus(accounts.donor1, 1);
    expect(status).toEqual({ ok: true, value: { amount: 300, requested: true, approved: false } });
  });

  it("should prevent refund request when campaign active", () => {
    contract.createCampaign(accounts.deployer, "Test", "Test");
    contract.donate(accounts.donor1, 1, 500);
    const requestResult = contract.requestRefund(accounts.donor1, 1, 300);
    expect(requestResult).toEqual({ ok: false, value: 104 });
  });

  it("should allow admin to approve refund", () => {
    contract.createCampaign(accounts.deployer, "Test", "Test");
    contract.donate(accounts.donor1, 1, 500);
    contract.deactivateCampaign(accounts.deployer, 1);
    contract.requestRefund(accounts.donor1, 1, 300);
    const approveResult = contract.approveRefund(accounts.deployer, accounts.donor1, 1);
    expect(approveResult).toEqual({ ok: true, value: true });
    const totalFunds = contract.getTotalFunds(1);
    expect(totalFunds).toEqual({ ok: true, value: 200 });
  });

  it("should prevent non-admin from approving refund", () => {
    contract.createCampaign(accounts.deployer, "Test", "Test");
    contract.donate(accounts.donor1, 1, 500);
    contract.deactivateCampaign(accounts.deployer, 1);
    contract.requestRefund(accounts.donor1, 1, 300);
    const approveResult = contract.approveRefund(accounts.donor2, accounts.donor1, 1);
    expect(approveResult).toEqual({ ok: false, value: 100 });
  });

  it("should allow admin to withdraw funds", () => {
    contract.createCampaign(accounts.deployer, "Test", "Test");
    contract.donate(accounts.donor1, 1, 1000);
    const withdrawResult = contract.withdrawFunds(accounts.deployer, 1, 400, accounts.recipient);
    expect(withdrawResult).toEqual({ ok: true, value: 400 });
    const totalFunds = contract.getTotalFunds(1);
    expect(totalFunds).toEqual({ ok: true, value: 600 });
    const recipientBalance = contract.getDonorContribution(accounts.recipient, 1);
    expect(recipientBalance).toEqual({ ok: true, value: 400 });
  });

  it("should prevent non-admin from withdrawing", () => {
    contract.createCampaign(accounts.deployer, "Test", "Test");
    contract.donate(accounts.donor1, 1, 1000);
    const withdrawResult = contract.withdrawFunds(accounts.donor1, 1, 400, accounts.recipient);
    expect(withdrawResult).toEqual({ ok: false, value: 100 });
  });

  it("should pause and unpause the contract", () => {
    const pauseResult = contract.pause(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    const isPaused = contract.isPaused();
    expect(isPaused).toEqual({ ok: true, value: true });

    const createDuringPause = contract.createCampaign(accounts.deployer, "Test", "Test");
    expect(createDuringPause).toEqual({ ok: false, value: 106 });

    const unpauseResult = contract.unpause(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    const isPausedAfter = contract.isPaused();
    expect(isPausedAfter).toEqual({ ok: true, value: false });
  });

  it("should allow admin to set new admin", () => {
    const setAdminResult = contract.setAdmin(accounts.deployer, accounts.donor1);
    expect(setAdminResult).toEqual({ ok: true, value: true });
    const newAdmin = contract.getAdmin();
    expect(newAdmin).toEqual({ ok: true, value: accounts.donor1 });
  });

  it("should prevent non-admin from setting admin", () => {
    const setAdminResult = contract.setAdmin(accounts.donor1, accounts.donor2);
    expect(setAdminResult).toEqual({ ok: false, value: 100 });
  });

  it("should deactivate a campaign", () => {
    contract.createCampaign(accounts.deployer, "Test", "Test");
    const deactivateResult = contract.deactivateCampaign(accounts.deployer, 1);
    expect(deactivateResult).toEqual({ ok: true, value: true });
    const details = contract.getCampaignDetails(1);
    if (details.value && typeof details.value !== "number") {
      expect(details.value.active).toBe(false);
    } else {
      expect.fail("Campaign details should be a Campaign object");
    }
  });
});