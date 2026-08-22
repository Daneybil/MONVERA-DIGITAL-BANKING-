export interface CountryOption {
  code: string; // ISO 2-letter
  name: string;
  dialCode: string;
  flag: string;
  currency: string;
  currencySymbol: string;
}

export const WORLD_COUNTRIES: CountryOption[] = [
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸', currency: 'USD', currencySymbol: '$' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧', currency: 'GBP', currencySymbol: '£' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦', currency: 'CAD', currencySymbol: '$' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺', currency: 'AUD', currencySymbol: '$' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪', currency: 'EUR', currencySymbol: '€' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷', currency: 'EUR', currencySymbol: '€' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭', currency: 'CHF', currencySymbol: 'CHF' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬', currency: 'SGD', currencySymbol: '$' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪', currency: 'AED', currencySymbol: 'د.إ' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵', currency: 'JPY', currencySymbol: '¥' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬', currency: 'NGN', currencySymbol: '₦' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦', currency: 'ZAR', currencySymbol: 'R' },
  { code: 'GH', name: 'Ghana', dialCode: '+233', flag: '🇬🇭', currency: 'GHS', currencySymbol: 'GH₵' },
  { code: 'KE', name: 'Kenya', dialCode: '+254', flag: '🇰🇪', currency: 'KES', currencySymbol: 'KSh' },
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳', currency: 'INR', currencySymbol: '₹' },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳', currency: 'CNY', currencySymbol: '¥' },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852', flag: '🇭🇰', currency: 'HKD', currencySymbol: '$' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿', currency: 'NZD', currencySymbol: '$' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱', currency: 'EUR', currencySymbol: '€' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪', currency: 'SEK', currencySymbol: 'kr' },
  { code: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴', currency: 'NOK', currencySymbol: 'kr' },
  { code: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰', currency: 'DKK', currencySymbol: 'kr' },
  { code: 'FI', name: 'Finland', dialCode: '+358', flag: '🇫🇮', currency: 'EUR', currencySymbol: '€' },
  { code: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪', currency: 'EUR', currencySymbol: '€' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸', currency: 'EUR', currencySymbol: '€' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹', currency: 'EUR', currencySymbol: '€' },
  { code: 'PT', name: 'Portugal', dialCode: '+351', flag: '🇵🇹', currency: 'EUR', currencySymbol: '€' },
  { code: 'BE', name: 'Belgium', dialCode: '+32', flag: '🇧🇪', currency: 'EUR', currencySymbol: '€' },
  { code: 'AT', name: 'Austria', dialCode: '+43', flag: '🇦🇹', currency: 'EUR', currencySymbol: '€' },
  { code: 'LU', name: 'Luxembourg', dialCode: '+352', flag: '🇱🇺', currency: 'EUR', currencySymbol: '€' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷', currency: 'BRL', currencySymbol: 'R$' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽', currency: 'MXN', currencySymbol: '$' },
  { code: 'AR', name: 'Argentina', dialCode: '+54', flag: '🇦🇷', currency: 'ARS', currencySymbol: '$' },
  { code: 'CL', name: 'Chile', dialCode: '+56', flag: '🇨🇱', currency: 'CLP', currencySymbol: '$' },
  { code: 'CO', name: 'Colombia', dialCode: '+57', flag: '🇨🇴', currency: 'COP', currencySymbol: '$' },
  { code: 'PE', name: 'Peru', dialCode: '+51', flag: '🇵🇪', currency: 'PEN', currencySymbol: 'S/.' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦', currency: 'SAR', currencySymbol: '﷼' },
  { code: 'QA', name: 'Qatar', dialCode: '+974', flag: '🇶🇦', currency: 'QAR', currencySymbol: '﷼' },
  { code: 'KW', name: 'Kuwait', dialCode: '+965', flag: '🇰🇼', currency: 'KWD', currencySymbol: 'د.ك' },
  { code: 'BH', name: 'Bahrain', dialCode: '+973', flag: '🇧🇭', currency: 'BHD', currencySymbol: '.د.ب' },
  { code: 'OM', name: 'Oman', dialCode: '+968', flag: '🇴🇲', currency: 'OMR', currencySymbol: '﷼' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬', currency: 'EGP', currencySymbol: 'E£' },
  { code: 'MA', name: 'Morocco', dialCode: '+212', flag: '🇲🇦', currency: 'MAD', currencySymbol: 'DH' },
  { code: 'IL', name: 'Israel', dialCode: '+972', flag: '🇮🇱', currency: 'ILS', currencySymbol: '₪' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷', currency: 'KRW', currencySymbol: '₩' },
  { code: 'TW', name: 'Taiwan', dialCode: '+886', flag: '🇹🇼', currency: 'TWD', currencySymbol: 'NT$' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾', currency: 'MYR', currencySymbol: 'RM' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩', currency: 'IDR', currencySymbol: 'Rp' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭', currency: 'PHP', currencySymbol: '₱' },
  { code: 'TH', name: 'Thailand', dialCode: '+66', flag: '🇹🇭', currency: 'THB', currencySymbol: '฿' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84', flag: '🇻🇳', currency: 'VND', currencySymbol: '₫' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰', currency: 'PKR', currencySymbol: '₨' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩', currency: 'BDT', currencySymbol: '৳' },
  { code: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷', currency: 'TRY', currencySymbol: '₺' },
  { code: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱', currency: 'PLN', currencySymbol: 'zł' },
  { code: 'CZ', name: 'Czech Republic', dialCode: '+420', flag: '🇨🇿', currency: 'CZK', currencySymbol: 'Kč' },
  { code: 'GR', name: 'Greece', dialCode: '+30', flag: '🇬🇷', currency: 'EUR', currencySymbol: '€' },
  { code: 'HU', name: 'Hungary', dialCode: '+36', flag: '🇭🇺', currency: 'HUF', currencySymbol: 'Ft' },
  { code: 'RO', name: 'Romania', dialCode: '+40', flag: '🇷🇴', currency: 'RON', currencySymbol: 'lei' },
  { code: 'CY', name: 'Cyprus', dialCode: '+357', flag: '🇨🇾', currency: 'EUR', currencySymbol: '€' },
  { code: 'MT', name: 'Malta', dialCode: '+356', flag: '🇲🇹', currency: 'EUR', currencySymbol: '€' },
  { code: 'IS', name: 'Iceland', dialCode: '+354', flag: '🇮🇸', currency: 'ISK', currencySymbol: 'kr' },
  { code: 'MC', name: 'Monaco', dialCode: '+377', flag: '🇲🇨', currency: 'EUR', currencySymbol: '€' },
  { code: 'LI', name: 'Liechtenstein', dialCode: '+423', flag: '🇱🇮', currency: 'CHF', currencySymbol: 'CHF' },
  { code: 'PA', name: 'Panama', dialCode: '+507', flag: '🇵🇦', currency: 'PAB', currencySymbol: 'B/.' },
  { code: 'CR', name: 'Costa Rica', dialCode: '+506', flag: '🇨🇷', currency: 'CRC', currencySymbol: '₡' },
  { code: 'UY', name: 'Uruguay', dialCode: '+598', flag: '🇺🇾', currency: 'UYU', currencySymbol: '$U' },
  { code: 'EC', name: 'Ecuador', dialCode: '+593', flag: '🇪🇨', currency: 'USD', currencySymbol: '$' },
  { code: 'RW', name: 'Rwanda', dialCode: '+250', flag: '🇷🇼', currency: 'RWF', currencySymbol: 'FRw' },
  { code: 'UG', name: 'Uganda', dialCode: '+256', flag: '🇺🇬', currency: 'UGX', currencySymbol: 'USh' },
  { code: 'TZ', name: 'Tanzania', dialCode: '+255', flag: '🇹🇿', currency: 'TZS', currencySymbol: 'TSh' },
  { code: 'CI', name: "Côte d'Ivoire", dialCode: '+225', flag: '🇨🇮', currency: 'XOF', currencySymbol: 'CFA' },
  { code: 'SN', name: 'Senegal', dialCode: '+221', flag: '🇸🇳', currency: 'XOF', currencySymbol: 'CFA' },
  { code: 'CM', name: 'Cameroon', dialCode: '+237', flag: '🇨🇲', currency: 'XAF', currencySymbol: 'FCFA' },
  { code: 'JM', name: 'Jamaica', dialCode: '+1876', flag: '🇯🇲', currency: 'JMD', currencySymbol: 'J$' },
  { code: 'BS', name: 'Bahamas', dialCode: '+1242', flag: '🇧🇸', currency: 'BSD', currencySymbol: '$' },
  { code: 'BB', name: 'Barbados', dialCode: '+1246', flag: '🇧🇧', currency: 'BBD', currencySymbol: 'Bds$' },
  { code: 'TT', name: 'Trinidad and Tobago', dialCode: '+1868', flag: '🇹🇹', currency: 'TTD', currencySymbol: 'TT$' },
  { code: 'KY', name: 'Cayman Islands', dialCode: '+1345', flag: '🇰🇾', currency: 'KYD', currencySymbol: '$' },
  { code: 'VG', name: 'British Virgin Islands', dialCode: '+1284', flag: '🇻🇬', currency: 'USD', currencySymbol: '$' },
  { code: 'BM', name: 'Bermuda', dialCode: '+1441', flag: '🇧🇲', currency: 'BMD', currencySymbol: '$' },
];

export function findCountry(countryNameOrCode: string): CountryOption {
  if (!countryNameOrCode) return WORLD_COUNTRIES[0];
  const query = countryNameOrCode.toLowerCase().trim();
  return (
    WORLD_COUNTRIES.find(
      (c) =>
        c.name.toLowerCase() === query ||
        c.code.toLowerCase() === query ||
        c.dialCode.toLowerCase() === query
    ) || WORLD_COUNTRIES[0]
  );
}
