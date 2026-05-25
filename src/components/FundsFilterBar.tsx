import React from 'react';
import { FolioXirrFilters } from '../lib/api';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface FundsFilterBarProps {
  filters: FolioXirrFilters;
  onChange: (filters: FolioXirrFilters) => void;
  themes: any[];
  fundHouses: string[];
  categories: string[];
  pans: string[];
  subCategories: string[];
  availableTags: string[];
}

export function FundsFilterBar({ 
  filters, 
  onChange, 
  themes,
  fundHouses, 
  categories, 
  pans, 
  subCategories,
  availableTags
}: FundsFilterBarProps) {
  const updateFilter = (key: keyof FolioXirrFilters, value: any) => {
    onChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onChange({
      activeOnly: true,
      themeId: '',
      tag: '',
      search: '',
      pan: '',
      fundHouse: '',
      category: '',
      subCategory: '',
      plan: undefined,
      fundOption: undefined
    });
  };

  return (
    <div className="space-y-5">
      {/* ROW 1: Search, PAN, Fund House, Active Only */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Search */}
        <div className="flex-1 min-w-[240px] space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Fund name or folio..."
              value={filters.search || ''}
              onChange={(e) => updateFilter('search', e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#01696f]/20"
            />
          </div>
        </div>

        {/* PAN */}
        <div className="w-[150px] space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            PAN
          </label>
          <select
            value={filters.pan || ''}
            onChange={(e) => updateFilter('pan', e.target.value || undefined)}
            className="block w-full pl-3 pr-10 py-1.5 text-sm border-slate-200 bg-slate-50 rounded-lg focus:outline-none focus:ring-[#01696f] focus:border-[#01696f]"
          >
            <option value="">All Investors</option>
            {pans.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Fund House */}
        <div className="min-w-[180px] space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fund House</label>
          <select
            value={filters.fundHouse || ''}
            onChange={(e) => updateFilter('fundHouse', e.target.value)}
            className="block w-full pl-3 pr-10 py-1.5 text-sm border-slate-200 bg-slate-50 rounded-lg focus:outline-none focus:ring-[#01696f] focus:border-[#01696f]"
          >
            <option value="">All Houses</option>
            {fundHouses.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>

        {/* Active Only */}
        <div className="flex items-center gap-2 pb-1.5">
          <button
            onClick={() => updateFilter('activeOnly', !filters.activeOnly)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#01696f] focus:ring-offset-2",
              filters.activeOnly ? "bg-[#01696f]" : "bg-slate-200"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                filters.activeOnly ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider cursor-pointer select-none" onClick={() => updateFilter('activeOnly', !filters.activeOnly)}>
            Active Only
          </label>
        </div>
      </div>

      {/* ROW 2: Category, Sub-category, Plan chips, Option chips */}
      <div className="flex flex-wrap items-end gap-6 pt-4 border-t border-slate-100">
        {/* Category */}
        <div className="min-w-[170px] space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category</label>
          <select
            value={filters.category || ''}
            onChange={(e) => {
              onChange({ ...filters, category: e.target.value || undefined, subCategory: undefined });
            }}
            className="block w-full pl-3 pr-10 py-1.5 text-sm border-slate-200 bg-slate-50 rounded-lg focus:outline-none focus:ring-[#01696f] focus:border-[#01696f]"
          >
            <option value="">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {/* Sub-category */}
        <div className="min-w-[170px] space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Sub-category
          </label>
          <select
            value={filters.subCategory || ''}
            onChange={(e) => updateFilter('subCategory', e.target.value || undefined)}
            disabled={subCategories.length === 0}
            className="block w-full pl-3 pr-10 py-1.5 text-sm border-slate-200 bg-slate-50 rounded-lg focus:outline-none focus:ring-[#01696f] focus:border-[#01696f] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="">All Sub-categories</option>
            {subCategories.map(sc => (
              <option key={sc} value={sc}>{sc}</option>
            ))}
          </select>
        </div>

        {/* Plan */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Plan</label>
          <div className="flex gap-1.5">
            {['All', 'Direct', 'Regular'].map(p => (
              <button
                key={p}
                onClick={() => updateFilter('plan', p === 'All' ? undefined : p)}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-full transition-colors",
                  (p === 'All' && !filters.plan) || filters.plan === p
                    ? "bg-[#01696f] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Option */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Option</label>
          <div className="flex gap-1.5">
            {['All', 'Growth', 'IDCW'].map(o => (
              <button
                key={o}
                onClick={() => updateFilter('fundOption', o === 'All' ? undefined : o)}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-full transition-colors",
                  (o === 'All' && !filters.fundOption) || filters.fundOption === o
                    ? "bg-[#01696f] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ROW 3: Theme dropdown, Tag dropdown, Clear All button */}
      <div className="flex flex-wrap items-center justify-between pt-4 border-t border-slate-100 gap-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Theme Dropdown */}
          <div className="min-w-[180px] space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Theme</label>
            <select
              value={filters.themeId || ''}
              onChange={(e) => {
                onChange({ ...filters, themeId: e.target.value, tag: '' });
              }}
              className="block w-full pl-3 pr-10 py-1.5 text-sm border-slate-200 bg-slate-50 rounded-lg focus:outline-none focus:ring-[#01696f] focus:border-[#01696f]"
            >
              <option value="">All Themes</option>
              {themes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Tag Dropdown */}
          <div className="min-w-[180px] space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tag</label>
            <select
              value={filters.tag || ''}
              onChange={(e) => updateFilter('tag', e.target.value)}
              disabled={!filters.themeId || availableTags.length === 0}
              className="block w-full pl-3 pr-10 py-1.5 text-sm border-slate-200 bg-slate-50 rounded-lg focus:outline-none focus:ring-[#01696f] focus:border-[#01696f] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <option value="">All Tags</option>
              {availableTags.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-colors border border-transparent hover:border-rose-100"
          >
            <X className="w-3.5 h-3.5" />
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
}
