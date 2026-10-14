/** Diagnostic only. Reads live operands; never assigns state, Math, or prototypes. */
export function solarMathProbe(state, eco, big, solarOutput) {
  const bits = value => { const data = new DataView(new ArrayBuffer(8)); data.setFloat64(0, value, false); return data.getBigUint64(0, false).toString(16).padStart(16, '0'); };
  const number = value => ({ value, bits: bits(value), precision: value.toPrecision(17) });
  const decimal = value => ({ string: value.toString(), mantissa: number(value.mantissa), exponent: value.exponent });
  const before = state.planets[0].resources.deuterium, increment = big(eco.net.deuterium);
  const [larger, smaller] = before.exponent >= increment.exponent ? [before, increment] : [increment, before];
  const scale = Number('1e' + (smaller.exponent - larger.exponent));
  const left = 1e14 * larger.mantissa, right = 1e14 * smaller.mantissa * scale;
  const variants = ['3ff76cf41f212d79', '3ff76cf41f212d7a'].map(hex => {
    const data = new DataView(new ArrayBuffer(8)); data.setBigUint64(0, BigInt('0x' + hex), false);
    const power = data.getFloat64(0, false), supply = 20 * (4 * power), efficiency = supply / eco.demand;
    const rate = ((10 * (1 * Math.pow(1.1, 1)) * (1.44 - .004 * 40) * efficiency) * 600 / 3600) * eco.global;
    const sum = 1e14 * before.mantissa + 1e14 * rate;
    return { classification: 'isolated arithmetic counterfactual, never adopted', power: number(power), supply: number(supply), efficiency: number(efficiency), rate: number(rate), sum: number(sum), rounded: number(Math.round(sum)), result: decimal(before.add(rate)) };
  });
  return { mathPowSource: Function.prototype.toString.call(Math.pow), powers: Object.fromEntries([1, 3, 4, 5].map(level => [level, number(Math.pow(1.1, level))])), actualSolarFunction: number(solarOutput(state.planets[0].buildings.solar_plant)), economy: Object.fromEntries(['supply', 'demand', 'efficiency', 'global'].map(key => [key, number(eco[key])])), netDeuterium: number(eco.net.deuterium), before: decimal(before), increment: decimal(increment), add: { larger: decimal(larger), smaller: decimal(smaller), scale: number(scale), left: number(left), right: number(right), sum: number(left + right), rounded: number(Math.round(left + right)), result: decimal(before.add(increment)) }, variants };
}
