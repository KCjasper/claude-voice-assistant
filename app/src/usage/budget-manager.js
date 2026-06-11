'use strict';

const crypto = require('crypto');
const ledger = require('./ledger');

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

class BudgetManager {
  constructor({ idFactory = () => crypto.randomUUID() } = {}) {
    this.idFactory = idFactory;
    this.reservations = new Map();
  }

  reservedUsd() {
    let total = 0;
    for (const reservation of this.reservations.values()) total += reservation.amountUsd;
    return total;
  }

  reserve({
    usage,
    monthlyCapUsd,
    requestedUsd,
    provider,
    allowPartial = false,
    date = new Date(),
  }) {
    const status = ledger.capStatus(usage, monthlyCapUsd, date);
    const requested = positive(requestedUsd);
    if (!status.enabled || requested === 0) {
      return {
        ok: true,
        id: null,
        amountUsd: requested,
        provider,
        usageSummary: status,
      };
    }

    const availableUsd = Math.max(0, status.remainingUsd - this.reservedUsd());
    if (availableUsd <= 0 || (!allowPartial && requested > availableUsd)) {
      return {
        ok: false,
        code: 'MONTHLY_CAP_WOULD_BE_EXCEEDED',
        error: 'The request would exceed the remaining monthly spending cap.',
        requestedUsd: requested,
        availableUsd,
        usageSummary: status,
      };
    }

    const amountUsd = allowPartial ? Math.min(requested, availableUsd) : requested;
    const id = this.idFactory();
    this.reservations.set(id, { amountUsd, provider });
    return {
      ok: true,
      id,
      amountUsd,
      provider,
      availableUsd,
      usageSummary: status,
    };
  }

  release(id) {
    if (!id) return null;
    const reservation = this.reservations.get(id) || null;
    this.reservations.delete(id);
    return reservation;
  }
}

module.exports = { BudgetManager };
