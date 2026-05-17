class PriceCalc {
  constructor(priceConfig, bindingFees = {}) {
    this.p = priceConfig;
    this.bindingFees = Object.assign(
      { none: 0, staple: 2.0, glue: 5.0, punch: 3.0 },
      bindingFees
    );
  }

  calculate(params) {
    const {
      file_pages,
      color_mode = 'bw',
      duplex = 'single',
      paper_size = 'A4',
      copies = 1,
      layout = '1in1',
      binding = 'none',
      print_range = null,
    } = params;

    if (!file_pages || file_pages <= 0 || !Number.isInteger(file_pages)) {
      throw new Error('页数必须为正整数');
    }
    if (!copies || copies <= 0 || !Number.isInteger(copies)) {
      throw new Error('份数必须为正整数');
    }

    let pages = file_pages;
    if (print_range) {
      const parts = print_range.split(',');
      pages = 0;
      for (const part of parts) {
        const rangeParts = part.split('-');
        if (rangeParts.length === 2) {
          const start = Math.max(1, parseInt(rangeParts[0]));
          const end = Math.min(file_pages, parseInt(rangeParts[1]));
          if (end >= start) pages += end - start + 1;
        } else {
          const p = parseInt(rangeParts[0]);
          if (p >= 1 && p <= file_pages) pages += 1;
        }
      }
      if (pages <= 0) pages = file_pages;
    }

    const layoutMultiplier = { '1in1': 1, '2in1': 0.5, '4in1': 0.25 };
    const lm = layoutMultiplier[layout] || 1;

    const rawSides = duplex === 'double' ? Math.ceil(pages / 2) : pages;
    const totalSides = Math.ceil(rawSides * copies * lm);

    const priceKey = `${paper_size.toLowerCase()}_${color_mode}_${duplex}`;
    let unitPrice = this.p[priceKey] || 0;
    if (unitPrice === 0) {
      unitPrice = this.p[`a4_${color_mode}_${duplex}`] || 1.0;
    }

    const sizeMultipliers = { a4: 1, a3: this.p.a3_multiplier || 2, a5: 0.5, '6寸': 0.8 };
    unitPrice *= sizeMultipliers[paper_size.toLowerCase()] || 1;

    const bindingFee = this.bindingFees[binding] || 0;

    const printAmount = Math.round(totalSides * unitPrice * 100) / 100;
    const totalAmount = Math.round((printAmount + bindingFee) * 100) / 100;

    const speedPerSide = 3;
    const estimatedSeconds = totalSides * speedPerSide + bindingFee * 5 + 20;

    return {
      total_sides: totalSides,
      unit_price: Math.round(unitPrice * 100) / 100,
      binding_fee: bindingFee,
      total_amount: totalAmount,
      price_breakdown: {
        items: [
          {
            label: `${paper_size}${color_mode === 'bw' ? '黑白' : '彩色'}${duplex === 'double' ? '双面' : '单面'} × ${totalSides}面`,
            amount: printAmount,
          },
          ...(binding !== 'none' ? [{ label: `装订费`, amount: bindingFee }] : []),
        ],
      },
      estimated_seconds: estimatedSeconds,
    };
  }
}

module.exports = PriceCalc;
