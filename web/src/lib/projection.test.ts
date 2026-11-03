import test from 'node:test';
import assert from 'node:assert/strict';
import { projectRefund } from './projection';
import { formatINR, rupeesToPaise } from './format';
import { parseCsv, toCsv } from './csv';

test('formatINR formats paise as rupees', () => {
  assert.equal(formatINR(123450), '₹1,234.50');
  assert.equal(formatINR(0), '₹0.00');
  assert.equal(formatINR(2500000), '₹25,000.00');
});
test('rupeesToPaise parses amounts without floats', () => {
  assert.equal(rupeesToPaise('1234.5'), 123450);
  assert.equal(rupeesToPaise('₹1,234.50'), 123450);
  assert.equal(rupeesToPaise('0.07'), 7);
  assert.equal(rupeesToPaise('-5'), null);
  assert.equal(rupeesToPaise('abc'), null);
});
test('projectRefund extrapolates the current spend rate', () => {
  const r = projectRefund({ balancePaise: 90000, deductedPaise: 10000, semesterStart: '2025-01-01', semesterEnd: '2025-04-10', today: '2025-01-10' });
  assert.equal(r.dailyAvgPaise, 1000);
  assert.equal(r.daysLeft, 90);
  assert.equal(r.projectedPaise, 0);
});
test('projectRefund never goes negative', () => {
  assert.equal(projectRefund({ balancePaise: 100, deductedPaise: 99999, semesterStart: '2025-01-01', semesterEnd: '2025-05-01', today: '2025-01-02' }).projectedPaise, 0);
});
test('projectRefund keeps part of the balance for a light eater', () => {
  const r = projectRefund({ balancePaise: 2000000, deductedPaise: 100000, semesterStart: '2025-01-01', semesterEnd: '2025-05-11', today: '2025-01-10' });
  assert.equal(r.projectedPaise, 2000000 - 10000 * 121);
});
test('csv round trip, quotes and formula-injection guard', () => {
  assert.deepEqual(parseCsv('a,"b,c"\r\n1,"x ""y"""\n'), [['a', 'b,c'], ['1', 'x "y"']]);
  assert.equal(toCsv([['=SUM(A1)', 'ok']]), "'=SUM(A1),ok\r\n");
});
