// Indian PIN Code serviceability and delivery estimator
const PINCODE_ZONES = {
  "1": { name: "North India (Delhi/Punjab/Haryana/HP/J&K)", daysMin: 3, daysMax: 5, cod: true },
  "2": { name: "North India (UP/Uttarakhand)", daysMin: 3, daysMax: 5, cod: true },
  "3": { name: "West India (Rajasthan/Gujarat)", daysMin: 3, daysMax: 4, cod: true },
  "4": { name: "West/Central India (Maharashtra/Goa/MP)", daysMin: 2, daysMax: 4, cod: true },
  "5": { name: "South India (Karnataka/AP/Telangana)", daysMin: 1, daysMax: 3, cod: true },
  "6": { name: "South India (Tamil Nadu/Kerala)", daysMin: 2, daysMax: 3, cod: true },
  "7": { name: "East & North-East India (WB/Odisha/Assam/NE)", daysMin: 4, daysMax: 6, cod: true },
  "8": { name: "East India (Bihar/Jharkhand)", daysMin: 4, daysMax: 6, cod: true },
};

exports.estimateDelivery = async (req, res) => {
  try {
    const { pincode, cartTotal = 0 } = req.query;

    if (!pincode || !/^[1-9][0-9]{5}$/.test(String(pincode).trim())) {
      return res.status(400).json({
        success: false,
        error: "Please enter a valid 6-digit Indian PIN code",
      });
    }

    const cleanPin = String(pincode).trim();
    const firstDigit = cleanPin[0];
    const zoneInfo = PINCODE_ZONES[firstDigit];

    if (!zoneInfo) {
      return res.status(404).json({
        success: false,
        serviceable: false,
        error: "Delivery is currently unavailable to this PIN code.",
      });
    }

    // Calculate estimated delivery dates
    const today = new Date();
    const minDeliveryDate = new Date(today);
    minDeliveryDate.setDate(today.getDate() + zoneInfo.daysMin);

    const maxDeliveryDate = new Date(today);
    maxDeliveryDate.setDate(today.getDate() + zoneInfo.daysMax);

    const formatOpt = { weekday: "short", month: "short", day: "numeric" };
    const dateRangeStr = `${minDeliveryDate.toLocaleDateString("en-IN", formatOpt)} - ${maxDeliveryDate.toLocaleDateString("en-IN", formatOpt)}`;

    const parsedTotal = parseFloat(cartTotal) || 0;
    const shippingFee = parsedTotal >= 499 ? 0 : 50;

    res.json({
      success: true,
      serviceable: true,
      pincode: cleanPin,
      region: zoneInfo.name,
      estimatedDelivery: dateRangeStr,
      minDays: zoneInfo.daysMin,
      maxDays: zoneInfo.daysMax,
      deliveryCharge: shippingFee,
      freeDeliveryThreshold: 499,
      codAvailable: zoneInfo.cod,
      courierPartner: "Delhivery / Blue Dart Express",
    });
  } catch (error) {
    console.error("estimateDelivery error:", error);
    res.status(500).json({ error: "Failed to estimate delivery" });
  }
};

