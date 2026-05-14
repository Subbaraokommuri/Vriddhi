import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, ChevronRight } from 'lucide-react';
import { TagTheme, FolioTagDetail } from '../lib/types.ts';
import { getFolioTags, assignTagToFolio, removeTagFromFolio } from '../lib/api.ts';

interface FolioTagChipsProps {
  folioId: string;
  themes: TagTheme[];
  onUpdate?: () => void;
}

export function FolioTagChips({ folioId, themes, onUpdate }: FolioTagChipsProps) {
  const [tags, setTags] = useState<FolioTagDetail[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchTags = async () => {
    try {
      const data = await getFolioTags(folioId);
      setTags(data);
      if (onUpdate) onUpdate();
    } catch (e) {
      console.error('Failed to fetch folio tags', e);
    }
  };

  useEffect(() => {
    fetchTags();
  }, [folioId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowAdd(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAssign = async (themeId: string, tag: string) => {
    setLoading(true);
    try {
      await assignTagToFolio(folioId, tag, themeId);
      await fetchTags();
      setShowAdd(false);
      setQuery('');
    } catch (e) {
      alert(`Failed to assign tag: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (tag: string) => {
    if (!window.confirm(`Remove tag "${tag}"?`)) return;
    try {
      await removeTagFromFolio(folioId, tag);
      await fetchTags();
    } catch (e) {
      alert(`Failed to remove tag: ${String(e)}`);
    }
  };

  // Filter themes and tags based on query
  const filteredThemes = themes.map(theme => ({
    ...theme,
    tags: theme.tags.filter(t => 
      t.toLowerCase().includes(query.toLowerCase()) && 
      !tags.some(existing => existing.tag === t)
    )
  })).filter(theme => theme.tags.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {tags.map((t) => (
        <span
          key={t.tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium"
          style={{ 
            borderColor: 'var(--color-border)', 
            backgroundColor: 'var(--color-background)',
            color: 'var(--color-text)'
          }}
          title={t.theme_name || 'Unassigned'}
        >
          {t.tag}
          <button
            onClick={() => handleRemove(t.tag)}
            className="hover:text-red-500 transition-colors"
          >
            <X size={10} />
          </button>
        </span>
      ))}

      <div className="relative" ref={dropdownRef}>
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium border-dashed hover:border-solid hover:bg-slate-50 transition-colors"
            style={{ 
              borderColor: 'var(--color-border)', 
              color: 'var(--color-text-muted)'
            }}
          >
            <Plus size={10} />
            add tag
          </button>
        ) : (
          <div className="flex flex-col">
            <input
              type="text"
              autoFocus
              placeholder="Filter tags..."
              className="px-2 py-0.5 border rounded-full text-[10px] w-24 focus:outline-none focus:ring-1"
              style={{ borderColor: 'var(--color-primary)' }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            
            {showAdd && (
              <div 
                className="absolute top-full left-0 mt-1 w-48 max-h-60 overflow-y-auto bg-white border rounded shadow-lg z-50 p-1"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {filteredThemes.length === 0 ? (
                  <div className="p-2 text-[10px] text-gray-500 italic">No tags found</div>
                ) : (
                  filteredThemes.map(theme => (
                    <div key={theme.id} className="mb-2">
                      <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                        {theme.name}
                      </div>
                      {theme.tags.map(tag => (
                        <button
                          key={tag}
                          className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-slate-100 rounded flex items-center justify-between"
                          onClick={() => handleAssign(theme.id, tag)}
                          disabled={loading}
                        >
                          {tag}
                          <ChevronRight size={10} className="text-gray-300" />
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
