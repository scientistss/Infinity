#!/usr/bin/env python3
"""Independent demolition A P/T oracle; Python standard library only.
Run: python scripts/demolition-spec-goldens.py > /tmp/demolition-spec-goldens.json
Does not import or execute game code. Decimal strings become exact Fractions.
These are mathematical specification goldens, not wallet/engine/save acceptance.
"""
from fractions import Fraction as F
from decimal import Decimal, localcontext
from math import floor
import json


def golden(name, base, factor, level, ion, *, cut='0', robotics=0, nanite=0, early=True):
    if not isinstance(level, int) or level < 1:
        raise ValueError('demolition requires a completed positive level')
    if not isinstance(ion, int) or ion < 0:
        raise ValueError('ion must be a completed nonnegative level')
    k = level - 1
    nominal = F(factor)
    effective = max(F('1.01'), nominal - F(cut))
    u = [F(x) / nominal if k == 0 else F(x) * effective ** (k - 1) for x in base]
    q = F(max(0, 25 - min(ion, 25)), 25)
    paid = [floor(x * q) for x in u]
    timing = [floor(x) for x in u]
    low_level = max(F(4) - F(k, 2), F(1)) if early else F(1)
    seconds = max(F(1), F((timing[0] + timing[1]) * 3600, 2500 * (1 + robotics) * 2 ** nanite * 600) / low_level)
    with localcontext() as ctx:
        ctx.prec = 40
        decimal_seconds = str(Decimal(seconds.numerator) / Decimal(seconds.denominator))
    return {
        'name': name,
        'input': {'base': list(base), 'factor': factor, 'growth_cut': cut, 'from_level': level,
                  'ion_level': ion, 'robotics_before': robotics, 'nanite_before': nanite, 'early_speedup': early},
        'paid_m_c_d': [str(x) for x in paid],
        'timing_basis_m_c_d': [str(x) for x in timing],
        'seconds_fraction': str(seconds), 'seconds_decimal': decimal_seconds,
    }


cases = [
    (golden('metal 16 to 15, ion 1', (60,15,0), '1.5', 16, 1), (16815,4203,0), (17515,4378,0), '65679/1250'),
    (golden('metal 10 to 9, ion 0', (60,15,0), '1.5', 10, 0), (1537,384,0), (1537,384,0), '5763/1250'),
    (golden('metal 10 to 9, ion 1', (60,15,0), '1.5', 10, 1), (1476,369,0), (1537,384,0), '5763/1250'),
    (golden('metal 10 to 9, ion 24', (60,15,0), '1.5', 10, 24), (61,15,0), (1537,384,0), '5763/1250'),
    (golden('metal 10 to 9, ion 25', (60,15,0), '1.5', 10, 25), (0,0,0), (1537,384,0), '5763/1250'),
    (golden('metal 10 to 9, ion 26', (60,15,0), '1.5', 10, 26), (0,0,0), (1537,384,0), '5763/1250'),
    (golden('metal 10 to 9, ion 1, growth cut', (60,15,0), '1.5', 10, 1, cut='0.01'), (1399,349,0), (1457,364,0), '5463/1250'),
    (golden('metal 1 to 0, ion 0', (60,15,0), '1.5', 1, 0), (40,10,0), (40,10,0), '1'),
    (golden('metal 1 to 0, ion 0, growth cut', (60,15,0), '1.5', 1, 0, cut='0.01'), (40,10,0), (40,10,0), '1'),
    (golden('metal 1 to 0, ion 1', (60,15,0), '1.5', 1, 1), (38,9,0), (40,10,0), '1'),
    (golden('metal 1 to 0, ion 1, growth cut', (60,15,0), '1.5', 1, 1, cut='0.01'), (38,9,0), (40,10,0), '1'),
    (golden('nanite 1 to 0, robotics 10, nanite 1', (1000000,500000,100000), '2', 1, 0, robotics=10, nanite=1, early=False), (500000,250000,50000), (500000,250000,50000), '900/11'),
    (golden('robotics 10 to 9, ion 1, robotics 10', (400,120,200), '2', 10, 1, robotics=10), (98304,29491,49152), (102400,30720,51200), '39936/1375'),
    (golden('metal storage 32 to 31, strict integer floor', (1000,0,0), '2', 32, 0), (1073741824000,0,0), (1073741824000,0,0), '12884901888/5'),
]
for result, expected_paid, expected_basis, expected_seconds in cases:
    assert result['paid_m_c_d'] == [str(x) for x in expected_paid], result
    assert result['timing_basis_m_c_d'] == [str(x) for x in expected_basis], result
    assert F(result['seconds_fraction']) == F(expected_seconds), result
try:
    golden('invalid level 0', (60,15,0), '1.5', 0, 0)
except ValueError:
    pass
else:
    raise AssertionError('level 0 must fail')
print(json.dumps({'oracle': 'Python Fraction, independent of production code', 'asserted_cases': len(cases),
                  'level_zero_rejected': True, 'cases': [row[0] for row in cases]}, ensure_ascii=False, indent=2))
