const PriceCalc = require('../../src/utils/price-calc');

describe('PriceCalc', () => {
  const testPrices = {
    a4_bw_single: 1.00,
    a4_bw_double: 1.50,
    a4_color_single: 3.00,
    a4_color_double: 5.00,
    a3_multiplier: 2.00,
    copy_premium: 1.00,
  };

  const calc = new PriceCalc(testPrices);

  test('A4黑白单面1份', () => {
    const result = calc.calculate({
      file_pages: 5, color_mode: 'bw', duplex: 'single',
      paper_size: 'A4', copies: 1, layout: '1in1', binding: 'none',
    });
    expect(result.total_sides).toBe(5);
    expect(result.unit_price).toBe(1);
    expect(result.total_amount).toBe(5);
  });

  test('A4黑白双面2份', () => {
    const result = calc.calculate({
      file_pages: 10, color_mode: 'bw', duplex: 'double',
      paper_size: 'A4', copies: 2, layout: '1in1', binding: 'none',
    });
    expect(result.total_sides).toBe(10);
    expect(result.total_amount).toBe(15);
  });

  test('A4彩色单面带装订', () => {
    const result = calc.calculate({
      file_pages: 3, color_mode: 'color', duplex: 'single',
      paper_size: 'A4', copies: 1, layout: '1in1', binding: 'staple',
    });
    expect(result.total_sides).toBe(3);
    expect(result.total_amount).toBe(11);
    expect(result.binding_fee).toBe(2);
  });

  test('A3倍率', () => {
    const result = calc.calculate({
      file_pages: 1, color_mode: 'bw', duplex: 'single',
      paper_size: 'A3', copies: 1, layout: '1in1', binding: 'none',
    });
    expect(result.unit_price).toBe(2);
    expect(result.total_amount).toBe(2);
  });

  test('2合1减少面数', () => {
    const result = calc.calculate({
      file_pages: 8, color_mode: 'bw', duplex: 'single',
      paper_size: 'A4', copies: 1, layout: '2in1', binding: 'none',
    });
    expect(result.total_sides).toBe(4);
  });

  test('页码范围', () => {
    const result = calc.calculate({
      file_pages: 10, color_mode: 'bw', duplex: 'single',
      paper_size: 'A4', copies: 1, layout: '1in1', binding: 'none',
      print_range: '2-5',
    });
    expect(result.total_sides).toBe(4);
    expect(result.total_amount).toBe(4);
  });

  test('多段页码范围', () => {
    const result = calc.calculate({
      file_pages: 10, color_mode: 'bw', duplex: 'single',
      paper_size: 'A4', copies: 1, layout: '1in1', binding: 'none',
      print_range: '1-2,5,8-9',
    });
    expect(result.total_sides).toBe(5);
  });
});
