/**
 * Monvera Digital Banking - Authoritative Banking Constants
 * Comprehensive worldwide country definitions, financial institutions, and ISO 4217 currencies.
 */

export interface CountryBankingConfig {
  code: string;
  name: string;
  flag: string;
  defaultCurrency: string;
  dialCode: string;
  identifierType: 'US_ROUTING' | 'UK_SORT_CODE' | 'AU_BSB' | 'IBAN_SWIFT' | 'INTERNATIONAL';
  ibanRequired?: boolean;
}

export interface BankInstitution {
  id: string;
  name: string;
  countryCode: string;
  category: 'MAJOR_US' | 'EUROPE_UK' | 'TURKEY' | 'NIGERIA_AFRICA' | 'MIDDLE_EAST' | 'ASIA_PACIFIC' | 'AMERICAS';
  openBankingSupported?: boolean;
}

export interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  commonCountries?: string[];
}

export const WORLD_COUNTRIES: CountryBankingConfig[] = [
  // High-volume jurisdictions
  { code: 'US', name: 'United States', flag: '🇺🇸', defaultCurrency: 'USD', dialCode: '+1', identifierType: 'US_ROUTING' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', defaultCurrency: 'GBP', dialCode: '+44', identifierType: 'UK_SORT_CODE', ibanRequired: true },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷', defaultCurrency: 'TRY', dialCode: '+90', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', defaultCurrency: 'NGN', dialCode: '+234', identifierType: 'INTERNATIONAL' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', defaultCurrency: 'AED', dialCode: '+971', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', defaultCurrency: 'CAD', dialCode: '+1', identifierType: 'US_ROUTING' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', defaultCurrency: 'EUR', dialCode: '+49', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'FR', name: 'France', flag: '🇫🇷', defaultCurrency: 'EUR', dialCode: '+33', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', defaultCurrency: 'JPY', dialCode: '+81', identifierType: 'INTERNATIONAL' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', defaultCurrency: 'AUD', dialCode: '+61', identifierType: 'AU_BSB' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', defaultCurrency: 'ZAR', dialCode: '+27', identifierType: 'INTERNATIONAL' },
  { code: 'IN', name: 'India', flag: '🇮🇳', defaultCurrency: 'INR', dialCode: '+91', identifierType: 'INTERNATIONAL' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', defaultCurrency: 'BRL', dialCode: '+55', identifierType: 'INTERNATIONAL' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', defaultCurrency: 'CHF', dialCode: '+41', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', defaultCurrency: 'SGD', dialCode: '+65', identifierType: 'INTERNATIONAL' },

  // Europe (IBAN-standardized)
  { code: 'AT', name: 'Austria', flag: '🇦🇹', defaultCurrency: 'EUR', dialCode: '+43', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪', defaultCurrency: 'EUR', dialCode: '+32', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'BG', name: 'Bulgaria', flag: '🇧🇬', defaultCurrency: 'EUR', dialCode: '+359', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'HR', name: 'Croatia', flag: '🇭🇷', defaultCurrency: 'EUR', dialCode: '+385', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'CY', name: 'Cyprus', flag: '🇨🇾', defaultCurrency: 'EUR', dialCode: '+357', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿', defaultCurrency: 'CZK', dialCode: '+420', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰', defaultCurrency: 'DKK', dialCode: '+45', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'EE', name: 'Estonia', flag: '🇪🇪', defaultCurrency: 'EUR', dialCode: '+372', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'FI', name: 'Finland', flag: '🇫🇮', defaultCurrency: 'EUR', dialCode: '+358', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'GR', name: 'Greece', flag: '🇬🇷', defaultCurrency: 'EUR', dialCode: '+30', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'HU', name: 'Hungary', flag: '🇭🇺', defaultCurrency: 'HUF', dialCode: '+36', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪', defaultCurrency: 'EUR', dialCode: '+353', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', defaultCurrency: 'EUR', dialCode: '+39', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'LV', name: 'Latvia', flag: '🇱🇻', defaultCurrency: 'EUR', dialCode: '+371', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'LT', name: 'Lithuania', flag: '🇱🇹', defaultCurrency: 'EUR', dialCode: '+370', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'LU', name: 'Luxembourg', flag: '🇱🇺', defaultCurrency: 'EUR', dialCode: '+352', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'MT', name: 'Malta', flag: '🇲🇹', defaultCurrency: 'EUR', dialCode: '+356', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', defaultCurrency: 'EUR', dialCode: '+31', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', defaultCurrency: 'NOK', dialCode: '+47', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'PL', name: 'Poland', flag: '🇵🇱', defaultCurrency: 'PLN', dialCode: '+48', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', defaultCurrency: 'EUR', dialCode: '+351', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'RO', name: 'Romania', flag: '🇷🇴', defaultCurrency: 'RON', dialCode: '+40', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'SK', name: 'Slovakia', flag: '🇸🇰', defaultCurrency: 'EUR', dialCode: '+421', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'SI', name: 'Slovenia', flag: '🇸🇮', defaultCurrency: 'EUR', dialCode: '+386', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', defaultCurrency: 'EUR', dialCode: '+34', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', defaultCurrency: 'SEK', dialCode: '+46', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'IS', name: 'Iceland', flag: '🇮🇸', defaultCurrency: 'ISK', dialCode: '+354', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'LI', name: 'Liechtenstein', flag: '🇱🇮', defaultCurrency: 'CHF', dialCode: '+423', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'MC', name: 'Monaco', flag: '🇲🇨', defaultCurrency: 'EUR', dialCode: '+377', identifierType: 'IBAN_SWIFT', ibanRequired: true },

  // Middle East & North Africa
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', defaultCurrency: 'SAR', dialCode: '+966', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'QA', name: 'Qatar', flag: '🇶🇦', defaultCurrency: 'QAR', dialCode: '+974', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'KW', name: 'Kuwait', flag: '🇰🇼', defaultCurrency: 'KWD', dialCode: '+965', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'BH', name: 'Bahrain', flag: '🇧🇭', defaultCurrency: 'BHD', dialCode: '+973', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'OM', name: 'Oman', flag: '🇴🇲', defaultCurrency: 'OMR', dialCode: '+968', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬', defaultCurrency: 'EGP', dialCode: '+20', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'IL', name: 'Israel', flag: '🇮🇱', defaultCurrency: 'ILS', dialCode: '+972', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'JO', name: 'Jordan', flag: '🇯🇴', defaultCurrency: 'JOD', dialCode: '+962', identifierType: 'IBAN_SWIFT', ibanRequired: true },
  { code: 'MA', name: 'Morocco', flag: '🇲🇦', defaultCurrency: 'MAD', dialCode: '+212', identifierType: 'INTERNATIONAL' },

  // Asia & Oceania
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', defaultCurrency: 'NZD', dialCode: '+64', identifierType: 'INTERNATIONAL' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰', defaultCurrency: 'HKD', dialCode: '+852', identifierType: 'INTERNATIONAL' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', defaultCurrency: 'MYR', dialCode: '+60', identifierType: 'INTERNATIONAL' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭', defaultCurrency: 'THB', dialCode: '+66', identifierType: 'INTERNATIONAL' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', defaultCurrency: 'IDR', dialCode: '+62', identifierType: 'INTERNATIONAL' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', defaultCurrency: 'PHP', dialCode: '+63', identifierType: 'INTERNATIONAL' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', defaultCurrency: 'KRW', dialCode: '+82', identifierType: 'INTERNATIONAL' },
  { code: 'TW', name: 'Taiwan', flag: '🇹🇼', defaultCurrency: 'TWD', dialCode: '+886', identifierType: 'INTERNATIONAL' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳', defaultCurrency: 'VND', dialCode: '+84', identifierType: 'INTERNATIONAL' },
  { code: 'PK', name: 'Pakistan', flag: '🇵🇰', defaultCurrency: 'PKR', dialCode: '+92', identifierType: 'IBAN_SWIFT' },
  { code: 'BD', name: 'Bangladesh', flag: '🇧🇩', defaultCurrency: 'BDT', dialCode: '+880', identifierType: 'INTERNATIONAL' },

  // Africa
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', defaultCurrency: 'KES', dialCode: '+254', identifierType: 'INTERNATIONAL' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', defaultCurrency: 'GHS', dialCode: '+233', identifierType: 'INTERNATIONAL' },
  { code: 'RW', name: 'Rwanda', flag: '🇷🇼', defaultCurrency: 'RWF', dialCode: '+250', identifierType: 'INTERNATIONAL' },
  { code: 'UG', name: 'Uganda', flag: '🇺🇬', defaultCurrency: 'UGX', dialCode: '+256', identifierType: 'INTERNATIONAL' },
  { code: 'TZ', name: 'Tanzania', flag: '🇹🇿', defaultCurrency: 'TZS', dialCode: '+255', identifierType: 'INTERNATIONAL' },

  // Americas
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', defaultCurrency: 'MXN', dialCode: '+52', identifierType: 'INTERNATIONAL' },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', defaultCurrency: 'ARS', dialCode: '+54', identifierType: 'INTERNATIONAL' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱', defaultCurrency: 'CLP', dialCode: '+56', identifierType: 'INTERNATIONAL' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴', defaultCurrency: 'COP', dialCode: '+57', identifierType: 'INTERNATIONAL' },
  { code: 'PE', name: 'Peru', flag: '🇵🇪', defaultCurrency: 'PEN', dialCode: '+51', identifierType: 'INTERNATIONAL' },
  { code: 'PA', name: 'Panama', flag: '🇵🇦', defaultCurrency: 'USD', dialCode: '+507', identifierType: 'INTERNATIONAL' },
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷', defaultCurrency: 'CRC', dialCode: '+506', identifierType: 'IBAN_SWIFT' },

  // Worldwide fallback
  { code: 'OTHER', name: 'Other International Jurisdiction', flag: '🌐', defaultCurrency: 'USD', dialCode: '+1', identifierType: 'INTERNATIONAL' },
];

export const MAJOR_BANKS: BankInstitution[] = [
  // United States Institutions
  { id: 'chase', name: 'JPMorgan Chase Bank', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'boa', name: 'Bank of America', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'wellsfargo', name: 'Wells Fargo', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'citi', name: 'Citibank', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'goldman', name: 'Goldman Sachs Bank', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'fidelity', name: 'Fidelity Investments', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'morganstanley', name: 'Morgan Stanley', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'usbank', name: 'U.S. Bancorp (US Bank)', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'pnc', name: 'PNC Bank', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'truist', name: 'Truist Financial', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'capitalone', name: 'Capital One', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'schwab', name: 'Charles Schwab Bank', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'td_us', name: 'TD Bank USA', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'citizens', name: 'Citizens Bank', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'keybank', name: 'KeyBank', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },
  { id: 'ally', name: 'Ally Bank', countryCode: 'US', category: 'MAJOR_US', openBankingSupported: true },

  // United Kingdom & Europe
  { id: 'barclays', name: 'Barclays Bank', countryCode: 'GB', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'hsbc', name: 'HSBC UK / Global', countryCode: 'GB', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'lloyds', name: 'Lloyds Banking Group', countryCode: 'GB', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'natwest', name: 'NatWest Group', countryCode: 'GB', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'standardchartered', name: 'Standard Chartered', countryCode: 'GB', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'deutschebank', name: 'Deutsche Bank', countryCode: 'DE', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'commerzbank', name: 'Commerzbank', countryCode: 'DE', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'bnpparibas', name: 'BNP Paribas', countryCode: 'FR', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'creditagricole', name: 'Credit Agricole', countryCode: 'FR', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'societegenerale', name: 'Societe Generale', countryCode: 'FR', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'santander', name: 'Banco Santander', countryCode: 'ES', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'bbva', name: 'BBVA', countryCode: 'ES', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'ubs', name: 'UBS Group', countryCode: 'CH', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'ing', name: 'ING Group', countryCode: 'NL', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'rabobank', name: 'Rabobank', countryCode: 'NL', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'intesasanpaolo', name: 'Intesa Sanpaolo', countryCode: 'IT', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'unicredit', name: 'UniCredit', countryCode: 'IT', category: 'EUROPE_UK', openBankingSupported: true },
  { id: 'nordea', name: 'Nordea Bank', countryCode: 'SE', category: 'EUROPE_UK', openBankingSupported: true },

  // Turkey (Prominently featured)
  { id: 'isbank', name: 'Türkiye İş Bankası (İşbank)', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'garantibbva', name: 'Garanti BBVA', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'ziraat', name: 'T.C. Ziraat Bankası', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'akbank', name: 'Akbank', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'yapikredi', name: 'Yapı Kredi Bankası', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'vakifbank', name: 'VakıfBank', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'halkbank', name: 'Halkbank', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'qnbfinans', name: 'QNB Finansbank', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'denizbank', name: 'DenizBank', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'teb', name: 'TEB (Türk Ekonomi Bankası)', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },
  { id: 'enpara', name: 'Enpara.com', countryCode: 'TR', category: 'TURKEY', openBankingSupported: true },

  // Nigeria & Africa (Prominently featured)
  { id: 'access', name: 'Access Bank', countryCode: 'NG', category: 'NIGERIA_AFRICA', openBankingSupported: true },
  { id: 'zenith', name: 'Zenith Bank', countryCode: 'NG', category: 'NIGERIA_AFRICA', openBankingSupported: true },
  { id: 'firstbank_ng', name: 'First Bank of Nigeria', countryCode: 'NG', category: 'NIGERIA_AFRICA', openBankingSupported: true },
  { id: 'gtbank', name: 'Guaranty Trust Bank (GTBank)', countryCode: 'NG', category: 'NIGERIA_AFRICA', openBankingSupported: true },
  { id: 'uba', name: 'United Bank for Africa (UBA)', countryCode: 'NG', category: 'NIGERIA_AFRICA', openBankingSupported: true },
  { id: 'stanbic_ng', name: 'Stanbic IBTC Bank', countryCode: 'NG', category: 'NIGERIA_AFRICA', openBankingSupported: true },
  { id: 'fidelity_ng', name: 'Fidelity Bank Nigeria', countryCode: 'NG', category: 'NIGERIA_AFRICA', openBankingSupported: true },
  { id: 'standardbank_za', name: 'Standard Bank', countryCode: 'ZA', category: 'NIGERIA_AFRICA', openBankingSupported: true },
  { id: 'fnb_za', name: 'First National Bank (FNB)', countryCode: 'ZA', category: 'NIGERIA_AFRICA', openBankingSupported: true },
  { id: 'absa_za', name: 'Absa Bank', countryCode: 'ZA', category: 'NIGERIA_AFRICA', openBankingSupported: true },

  // United Arab Emirates & Middle East
  { id: 'emiratesnbd', name: 'Emirates NBD', countryCode: 'AE', category: 'MIDDLE_EAST', openBankingSupported: true },
  { id: 'fab', name: 'First Abu Dhabi Bank (FAB)', countryCode: 'AE', category: 'MIDDLE_EAST', openBankingSupported: true },
  { id: 'adcb', name: 'Abu Dhabi Commercial Bank (ADCB)', countryCode: 'AE', category: 'MIDDLE_EAST', openBankingSupported: true },
  { id: 'dubaiislamic', name: 'Dubai Islamic Bank', countryCode: 'AE', category: 'MIDDLE_EAST', openBankingSupported: true },
  { id: 'alrajhi', name: 'Al Rajhi Bank', countryCode: 'SA', category: 'MIDDLE_EAST', openBankingSupported: true },
  { id: 'snb', name: 'Saudi National Bank (SNB)', countryCode: 'SA', category: 'MIDDLE_EAST', openBankingSupported: true },
  { id: 'qnb', name: 'Qatar National Bank (QNB)', countryCode: 'QA', category: 'MIDDLE_EAST', openBankingSupported: true },

  // Canada & Americas
  { id: 'rbc', name: 'Royal Bank of Canada (RBC)', countryCode: 'CA', category: 'AMERICAS', openBankingSupported: true },
  { id: 'td_ca', name: 'TD Canada Trust', countryCode: 'CA', category: 'AMERICAS', openBankingSupported: true },
  { id: 'scotiabank', name: 'Scotiabank', countryCode: 'CA', category: 'AMERICAS', openBankingSupported: true },
  { id: 'bmo', name: 'Bank of Montreal (BMO)', countryCode: 'CA', category: 'AMERICAS', openBankingSupported: true },
  { id: 'cibc', name: 'CIBC', countryCode: 'CA', category: 'AMERICAS', openBankingSupported: true },
  { id: 'itau', name: 'Itaú Unibanco', countryCode: 'BR', category: 'AMERICAS', openBankingSupported: true },
  { id: 'bradesco', name: 'Banco Bradesco', countryCode: 'BR', category: 'AMERICAS', openBankingSupported: true },
  { id: 'bbva_mx', name: 'BBVA Mexico', countryCode: 'MX', category: 'AMERICAS', openBankingSupported: true },

  // Australia & Asia Pacific
  { id: 'cba', name: 'Commonwealth Bank of Australia (CBA)', countryCode: 'AU', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'westpac', name: 'Westpac Banking Corporation', countryCode: 'AU', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'anz', name: 'ANZ Banking Group', countryCode: 'AU', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'nab', name: 'National Australia Bank (NAB)', countryCode: 'AU', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'macquarie', name: 'Macquarie Bank', countryCode: 'AU', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'dbs', name: 'DBS Bank', countryCode: 'SG', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'ocbc', name: 'OCBC Bank', countryCode: 'SG', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'uob', name: 'United Overseas Bank (UOB)', countryCode: 'SG', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'mufg', name: 'Mitsubishi UFJ Financial Group', countryCode: 'JP', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'sbi', name: 'State Bank of India (SBI)', countryCode: 'IN', category: 'ASIA_PACIFIC', openBankingSupported: true },
  { id: 'hdfc', name: 'HDFC Bank', countryCode: 'IN', category: 'ASIA_PACIFIC', openBankingSupported: true },
];

export const WORLD_CURRENCIES: CurrencyConfig[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'Mex$' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: '﷼' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BD' },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
];
