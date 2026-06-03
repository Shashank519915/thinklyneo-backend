/**
 * @fileoverview Credits utility library: manages microcredit transactions, estimates, holds, and reconciliations in Postgres.
 */

import { prisma } from "./prisma";
import { estimateWorkflowCostMicrocredits } from "@galaxy/shared";

const INITIAL_GRANT_MICROCREDITS = 100000000; // 100.00 credits

/**
 * Gets the current balance for a user. If no balance exists, initializes a default balance
 * of 100 credits and logs an initial_grant transaction.
 */
export async function getOrCreateBalance(
  userId: string,
  txClient?: any
): Promise<number> {
  const client = txClient || prisma;

  const existing = await client.creditBalance.findUnique({
    where: { userId },
  });

  if (existing) {
    return existing.balance;
  }

  // Create default initial grant transactionally
  const result = await prisma.$transaction(async (tx) => {
    // Double-check inside transaction to avoid race conditions
    const innerExisting = await tx.creditBalance.findUnique({
      where: { userId },
    });
    if (innerExisting) return innerExisting;

    const newBalance = await tx.creditBalance.create({
      data: {
        userId,
        balance: INITIAL_GRANT_MICROCREDITS,
      },
    });

    await tx.creditLedger.create({
      data: {
        userId,
        amount: INITIAL_GRANT_MICROCREDITS,
        type: "initial_grant",
        description: "Initial signup credits grant",
        balanceAfter: INITIAL_GRANT_MICROCREDITS,
      },
    });

    return newBalance;
  });

  return result.balance;
}

/**
 * Sums up the base credit costs of all nodes inside the given workflow list.
 */
export function estimateWorkflowCost(nodes: any[]): number {
  return estimateWorkflowCostMicrocredits(nodes);
}

/**
 * Checks if the user has a sufficient balance to cover the estimated amount.
 */
export async function hasSufficientCredits(
  userId: string,
  amount: number
): Promise<boolean> {
  const balance = await getOrCreateBalance(userId);
  return balance >= amount;
}

/**
 * Places an estimated credit hold for a workflow run inside an atomic transaction.
 */
export async function placeCreditHold(
  userId: string,
  amount: number,
  runId: string
): Promise<void> {
  if (amount <= 0) return;

  await prisma.$transaction(async (tx) => {
    const balance = await getOrCreateBalance(userId, tx);

    if (balance < amount) {
      throw new Error("Insufficient credit balance to start workflow run");
    }

    const nextBalance = balance - amount;

    await tx.creditBalance.update({
      where: { userId },
      data: { balance: nextBalance },
    });

    await tx.creditLedger.create({
      data: {
        userId,
        amount: -amount, // Negative to represent hold
        type: "hold",
        description: `Hold for workflow execution run ${runId}`,
        runId,
        balanceAfter: nextBalance,
      },
    });
  });
}

/**
 * Reconciles the workflow run balance: releases the estimated hold and deducts the actual cost.
 */
export async function reconcileWorkflowCredits(
  userId: string,
  runId: string,
  actualCost: number,
  holdAmount: number
): Promise<void> {
  // If no hold was placed, charge the actual cost directly
  if (holdAmount <= 0) {
    if (actualCost <= 0) return;
    await prisma.$transaction(async (tx) => {
      const balance = await getOrCreateBalance(userId, tx);
      const nextBalance = balance - actualCost;
      await tx.creditBalance.update({
        where: { userId },
        data: { balance: nextBalance },
      });
      await tx.creditLedger.create({
        data: {
          userId,
          amount: -actualCost,
          type: "deduction",
          description: `Direct charge for workflow run ${runId}`,
          runId,
          balanceAfter: nextBalance,
        },
      });
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const currentBalance = await getOrCreateBalance(userId, tx);
    
    // Release hold amount back to balance
    const afterReleaseBalance = currentBalance + holdAmount;
    
    // Deduct actual cost from balance
    const finalBalance = afterReleaseBalance - actualCost;

    // Update current balance
    await tx.creditBalance.update({
      where: { userId },
      data: { balance: finalBalance },
    });

    // Log the actual cost deduction
    await tx.creditLedger.create({
      data: {
        userId,
        amount: -actualCost,
        type: "deduction",
        description: `Actual cost consumed by workflow run ${runId}`,
        runId,
        balanceAfter: finalBalance - (holdAmount - actualCost), // Temp audit alignment
      },
    });

    // If hold was greater than actual cost, log a refund entry for clarity
    if (holdAmount > actualCost) {
      const refundAmount = holdAmount - actualCost;
      await tx.creditLedger.create({
        data: {
          userId,
          amount: refundAmount,
          type: "refund",
          description: `Refund for run ${runId} (Hold: ${(holdAmount/1000000).toFixed(2)}M, Actual: ${(actualCost/1000000).toFixed(2)}M)`,
          runId,
          balanceAfter: finalBalance,
        },
      });
    } else if (actualCost > holdAmount) {
      // If actual cost was somehow larger than the hold (e.g. dynamic settings modified),
      // we already deducted the difference, log this correction for bookkeeping
      const extraDeduction = actualCost - holdAmount;
      await tx.creditLedger.create({
        data: {
          userId,
          amount: -extraDeduction,
          type: "deduction",
          description: `Additional deduction adjustment for run ${runId}`,
          runId,
          balanceAfter: finalBalance,
        },
      });
    }
  });
}
