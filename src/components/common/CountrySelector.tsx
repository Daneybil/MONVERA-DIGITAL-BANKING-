import React, { useState, useRef, useEffect } from 'react';
import { WORLD_COUNTRIES, CountryOption } from '../../data/countries';
import { Search, ChevronDown, Check, Globe } from 'lucide-react';

interface CountrySelectorProps {
  value: string; // Country Name or Code
  onChange: (country: CountryOption) => void;
  label?: string;
  showDialCode?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  placeholder?: string;
}

// Top Popular International Countries (as seen in the reference)
const POPULAR_COUNTRY_CODES = ['US', 'GB', 'CA', 'AU', 'DE', 'CH', 'FR', 'SG', 'AE', 'NG', 'ZA'];

export const CountrySelector: React.FC<CountrySelectorProps> = ({
  value,
  onChange,
  label = 'Country',
  showDialCode = false,
  required = false,
  className = '',
  id = 'country-selector',
  placeholder = 'Select your country',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Match selected country
  const selectedCountry = value
    ? WORLD_COUNTRIES.find(
        (c) =>
          c.name.toLowerCase() === value.toLowerCase() ||
          c.code.toLowerCase() === value.toLowerCase()
      )
    : null;

  // Filter countries based on search
  const filteredCountries = WORLD_COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.dialCode.includes(searchQuery)
  );

  const popularCountries = WORLD_COUNTRIES.filter((c) =>
    POPULAR_COUNTRY_CODES.includes(c.code)
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`space-y-1.5 relative ${className}`} ref={dropdownRef}>
      {label && (
        <label className="block text-xs font-semibold text-slate-700 font-sans">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      {/* Trigger Button */}
      <button
        id={id}
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setSearchQuery('');
        }}
        className="w-full flex items-center justify-between px-3.5 py-3 bg-white hover:bg-slate-50 border border-slate-200 focus:border-slate-800 rounded-xl text-left transition-all shadow-2xs group cursor-pointer"
      >
        <div className="flex items-center gap-3 truncate">
          {selectedCountry ? (
            <>
              <span className="text-xl leading-none select-none">{selectedCountry.flag}</span>
              <span className="font-semibold text-sm text-slate-900 truncate">
                {selectedCountry.name}
              </span>
              {showDialCode && (
                <span className="text-xs font-mono font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                  {selectedCountry.dialCode}
                </span>
              )}
            </>
          ) : (
            <>
              <Globe className="w-5 h-5 text-slate-400 shrink-0" />
              <span className="text-sm text-slate-400 font-medium">{placeholder}</span>
            </>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180 text-slate-800' : ''
          }`}
        />
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-80 flex flex-col">
          {/* Search Box */}
          <div className="p-3 bg-slate-50 border-b border-slate-200">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search country or code (e.g. United States, +1, +44)..."
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm font-medium bg-white rounded-xl border border-slate-300 focus:outline-hidden focus:border-slate-900"
              />
            </div>
          </div>

          {/* Country List */}
          <div className="overflow-y-auto divide-y divide-slate-100 p-1 flex-1">
            {/* Show Popular section if not searching */}
            {!searchQuery && (
              <div className="pb-2">
                <div className="px-3 pt-2 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                  Popular Countries
                </div>
                {popularCountries.map((country) => {
                  const isSelected = selectedCountry?.code === country.code;
                  return (
                    <button
                      key={`pop-${country.code}`}
                      type="button"
                      onClick={() => {
                        onChange(country);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs sm:text-sm transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-slate-900 text-white font-bold'
                          : 'hover:bg-slate-100 text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <span className="text-lg leading-none">{country.flag}</span>
                        <span className="truncate font-medium">{country.name}</span>
                        <span
                          className={`text-[11px] font-mono ${
                            isSelected ? 'text-slate-300' : 'text-slate-400'
                          }`}
                        >
                          ({country.dialCode})
                        </span>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
                <div className="px-3 pt-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono border-t border-slate-100 mt-2">
                  All Countries ({WORLD_COUNTRIES.length})
                </div>
              </div>
            )}

            {filteredCountries.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 font-medium">
                No matching country found.
              </div>
            ) : (
              filteredCountries.map((country) => {
                const isSelected = selectedCountry?.code === country.code;
                return (
                  <button
                    key={country.code}
                    type="button"
                    onClick={() => {
                      onChange(country);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs sm:text-sm transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 text-white font-bold'
                        : 'hover:bg-slate-100 text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="text-lg leading-none">{country.flag}</span>
                      <span className="truncate font-medium">{country.name}</span>
                      <span
                        className={`text-[11px] font-mono ${
                          isSelected ? 'text-slate-300' : 'text-slate-400'
                        }`}
                      >
                        ({country.dialCode})
                      </span>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
