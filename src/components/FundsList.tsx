import React, { useState, useEffect } from 'react';
import { AlertCircle, Download, Clock, Filter, Tag } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '../lib/utils.ts';
import { Folio, TagTheme, FolioTagDetail } from '../lib/types.ts';
import { fetchFolios, getFolioTags } from '../lib/api.ts';
import { FolioTagChips } from './FolioTagChips.tsx';

interface FundsListProps {
  themes: TagTheme[];
  folios: Folio[];
  activeOnly: boolean;
  setActiveOnly: (val: boolean) => void;
}

export function FundsList({ themes, folios, activeOnly, setActiveOnly }: FundsListProps) {
  const [loading, setLoading] = useState(true);
  const [folioTags, setFolioTags] = useState<Record<string, FolioTagDetail[]>>({});
  
  // Filtering state
  const [selectedThemeId, setSelectedThemeId] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAssignments = async (folioList: Folio[]) => {
    setLoading(true);
    try {
      const assignments: Record<string, FolioTagDetail[]> = {};
      await Promise.all(folioList.map(async (f) => {
        try {
          const tags = await getFolioTags(f.id);
          assignments[f.id] = tags;
        } catch (e) {
          console.error(`Failed to fetch tags for folio ${f.id}`, e);
        }
      }));
      setFolioTags(assignments);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (folios && folios.length > 0) {
      fetchAssignments(folios);
    }
  }, [folios]);

  const refreshFolioTags = async (folioId: string) => {
    try {
      const tags = await getFolioTags(folioId);
      setFolioTags(prev => ({
        ...prev,
        [folioId]: tags
      }));
    } catch (e) {
      console.error(`Failed to refresh tags for folio ${folioId}`, e);
    }
  };

  const selectedTheme = themes.find(t => t.id === selectedThemeId);

  const filteredFolios = (folios ?? []).filter(f => {
    // Active only filter (passed as prop)
    if (activeOnly && (f.currentUnits ?? 0) <= 0.001) return false;
    
    // Tag filter
    if (selectedTag !== 'all') {
      const tags = folioTags[f.id] || [];
      if (!tags.some(t => t.tag === selectedTag)) return false;
    } else if (selectedThemeId !== 'all') {
      const tags = folioTags[f.id] || [];
      const themeTags = selectedTheme?.tags || [];
      if (!tags.some(t => themeTags.includes(t.tag))) return false;
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return f.fund_name.toLowerCase().includes(q) || f.folio_number.toLowerCase().includes(q);
    }

    return true;
  });

  if (!folios) return <div className="p-4 text-gray-500">Loading holdings...</div>;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-8 h-8 border-4 border-[#01696f] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 font-medium">Loading Funds...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
          <Filter size={16} className="text-slate-400" />
          <select 
            className="bg-transparent border-none focus:ring-0 text-sm font-medium text-slate-700 outline-none"
            value={selectedThemeId}
            onChange={(e) => {
              setSelectedThemeId(e.target.value);
              setSelectedTag('all');
            }}
          >
            <option value="all">All Themes</option>
            {themes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
          <Tag size={16} className="text-slate-400" />
          <select 
            className="bg-transparent border-none focus:ring-0 text-sm font-medium text-slate-700 outline-none disabled:opacity-50"
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            disabled={selectedThemeId === 'all'}
          >
            <option value="all">All Tags</option>
            {selectedTheme?.tags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>

        <input
          type="text"
          placeholder="Search funds or folios..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-grow px-4 py-2 bg-slate-50 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-[#01696f]/30"
        />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-lg font-bold">Funds & Folios</h3>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer group">
              <div 
                onClick={() => setActiveOnly(!activeOnly)}
                className={cn(
                  "w-10 h-5 rounded-full transition-colors relative",
                  activeOnly ? "bg-[#01696f]" : "bg-slate-200"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-3 h-3 bg-white rounded-full transition-transform",
                  activeOnly ? "translate-x-6" : "translate-x-1"
                )} />
              </div>
              <span className="text-sm font-bold text-slate-600 group-hover:text-[#01696f] transition-colors">Active Only</span>
              <span className="text-xs text-slate-400 font-normal">
                ({filteredFolios.length}/{folios.length})
              </span>
            </label>
            <div className="flex gap-2">
              <button 
                onClick={() => window.location.href = '/api/export-holdings-csv'}
                className="flex items-center gap-2 px-3 py-2 bg-[#01696f] text-white rounded-lg hover:bg-opacity-90 transition-all text-sm font-bold shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Fund Name & Tags</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Units</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">NAV</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Last Updated</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Current Value</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredFolios.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    No funds found.
                  </td>
                </tr>
              ) : (
                filteredFolios.map((folio) => (
                  <tr key={folio.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <p className="font-semibold text-sm">{folio.fund_name}</p>
                        <p className="text-[10px] text-slate-500">Folio: {folio.folio_number}</p>
                        <FolioTagChips 
                          folioId={folio.id} 
                          themes={themes} 
                          onUpdate={() => refreshFolioTags(folio.id)}
                        />
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-medium">
                      {(folio.currentUnits ?? 0).toFixed(3)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-medium">
                      ₹{(folio.nav ?? 0).toFixed(4)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-xs text-slate-500">
                      {folio.navDate ? (
                        <div className="flex items-center justify-end gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(folio.navDate)}
                        </div>
                      ) : 'Never'}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-[#01696f]">
                      {formatCurrency(folio.currentValue)}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold uppercase text-slate-600">
                        {folio.category || 'Mutual Fund'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
