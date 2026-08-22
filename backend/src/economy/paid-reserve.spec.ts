import { applyPaidReserveMutation } from './paid-reserve';

describe('applyPaidReserveMutation', () => {
  it('spends free value before paid value', () => {
    expect(applyPaidReserveMutation({ balance: 100, paidBalance: 60 }, -30, false, false)).toEqual({ balance: 70, paidBalance: 60 });
    expect(applyPaidReserveMutation({ balance: 70, paidBalance: 60 }, -20, false, false)).toEqual({ balance: 50, paidBalance: 50 });
  });

  it('does not count membership benefits as paid', () => {
    expect(applyPaidReserveMutation({ balance: 0, paidBalance: 0 }, 15, false, false)).toEqual({ balance: 15, paidBalance: 0 });
  });

  it('reduces paid reserve first for reversals', () => {
    expect(applyPaidReserveMutation({ balance: 20, paidBalance: 20 }, -30, false, true)).toEqual({ balance: -10, paidBalance: 0 });
  });
});
