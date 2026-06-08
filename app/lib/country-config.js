/**
 * Country-specific tax and company entity configuration.
 * Used in invoice generation and the Order Detail invoice edit panel.
 *
 * taxRate: decimal fraction (e.g. 0.10 = 10%)
 * taxLabel: label shown on invoice (GST / VAT / SALES TAX)
 * taxCode: code shown in the Tax Code column of the items table
 * currency: default billing currency code
 *
 * Pricing model: GST/VAT INCLUSIVE.
 * Given a gross total T at rate r:
 *   tax  = T × r / (1 + r)
 *   excl = T / (1 + r)
 */
export const COUNTRY_CONFIG = {
  Australia: {
    taxLabel:  'GST',
    taxRate:   0.10,
    taxCode:   'GST',
    currency:  'AUD',
    company: {
      line1:  'BLACKCROW INTERNATIONAL PTY LTD TRADING AS',
      line2:  'BLACKCROW AUTOMOTIVE ACCESSORIES',
      reg:    'ABN 30 693 694 932',
      addr:   '3/17-25 KINDER ST, CAMPBELLFIELD, VIC, 3061',
      tel:    'TEL: 03 9359 2061   MOB: 0451 420 958',
      emails: ['SALES@BLACKCROWAUTO.COM', 'SUPPORT@BLACKCROWAUTO.COM.AU'],
      web:    'WWW.BLACKCROWAUTO.COM.AU',
    },
  },

  UK: {
    taxLabel:  'VAT',
    taxRate:   0.20,
    taxCode:   'VAT20',
    currency:  'GBP',
    company: {
      line1:  'BLACKCROW AUTOMOTIVE UK LTD',
      line2:  '',
      reg:    'VAT No: GB000 000 000',
      addr:   'UNITED KINGDOM',
      tel:    '',
      emails: ['SALES@BLACKCROWAUTO.COM'],
      web:    'WWW.BLACKCROWAUTO.COM.AU',
    },
  },

  USA: {
    taxLabel:  'SALES TAX',
    taxRate:   0,
    taxCode:   'EXEMPT',
    currency:  'USD',
    company: {
      line1:  'BLACKCROW AUTOMOTIVE USA LLC',
      line2:  '',
      reg:    'EIN: 00-0000000',
      addr:   'UNITED STATES',
      tel:    '',
      emails: ['SALES@BLACKCROWAUTO.COM'],
      web:    'WWW.BLACKCROWAUTO.COM',
    },
  },

  Canada: {
    taxLabel:  'GST/HST',
    taxRate:   0.05,
    taxCode:   'GST5',
    currency:  'CAD',
    company: {
      line1:  'BLACKCROW AUTOMOTIVE CANADA INC',
      line2:  '',
      reg:    'BN/GST: 000000000',
      addr:   'CANADA',
      tel:    '',
      emails: ['SALES@BLACKCROWAUTO.COM'],
      web:    'WWW.BLACKCROWAUTO.COM.AU',
    },
  },

  Sweden: {
    taxLabel:  'VAT',
    taxRate:   0.25,
    taxCode:   'VAT25',
    currency:  'SEK',
    company: {
      line1:  'BLACKCROW AUTOMOTIVE AB',
      line2:  '',
      reg:    'VAT No: SE000000000001',
      addr:   'SWEDEN',
      tel:    '',
      emails: ['SALES@BLACKCROWAUTO.COM'],
      web:    'WWW.BLACKCROWAUTO.COM.AU',
    },
  },
};

/** Map common customer.country values → a COUNTRY_CONFIG key */
export function resolveCountryKey(rawCountry) {
  if (!rawCountry) return 'Australia';
  const c = rawCountry.trim().toLowerCase();
  if (c === 'australia' || c === 'au')                        return 'Australia';
  if (c === 'uk' || c === 'united kingdom' || c === 'gb')     return 'UK';
  if (c === 'usa' || c === 'united states' || c === 'us')     return 'USA';
  if (c === 'canada' || c === 'ca')                           return 'Canada';
  if (c === 'sweden' || c === 'se' || c === 'sverige')        return 'Sweden';
  return 'Australia'; // default fallback
}
