import React, { useState } from 'react';
import { Plus, X, Edit2, Trash2, Tag } from 'lucide-react';
import { TagTheme } from '../lib/types.ts';
import { cn } from '../lib/utils.ts';

interface TagManagerProps {
  themes: TagTheme[];
  unassignedTags: string[];
  onCreateTheme: (name: string) => void;
  onRenameTheme: (id: string, name: string) => void;
  onDeleteTheme: (id: string) => void;
  onAddTag: (themeId: string, tag: string) => void;
  onRenameTag: (themeId: string, oldTag: string, newTag: string) => void;
  onDeleteTag: (themeId: string, tag: string) => void;
  onDeleteUnassignedTag: (tag: string) => void;
  onSyncAllMf: () => Promise<{ assigned: number; skipped: number; total: number }>;
}

export function TagManager({
  themes,
  unassignedTags,
  onCreateTheme,
  onRenameTheme,
  onDeleteTheme,
  onAddTag,
  onRenameTag,
  onDeleteTag,
  onDeleteUnassignedTag,
  onSyncAllMf,
}: TagManagerProps) {
  const [newThemeName, setNewThemeName] = useState('');
  const [showNewThemeInput, setShowNewThemeInput] = useState(false);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [editingThemeName, setEditingThemeName] = useState('');
  const [newTagNames, setNewTagNames] = useState<Record<string, string>>({});
  const [editingTag, setEditingTag] = useState<{ themeId: string; tag: string } | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [syncResult, setSyncResult] = useState<{ assigned: number; skipped: number; total: number } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const handleSyncAllMf = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await onSyncAllMf();
      setSyncResult(result);
    } catch (e) {
      setSyncResult({ assigned: -1, skipped: -1, total: -1 });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 5000);
    }
  };

  const handleCreateTheme = (e: React.FormEvent) => {
    e.preventDefault();
    if (newThemeName.trim()) {
      onCreateTheme(newThemeName.trim());
      setNewThemeName('');
      setShowNewThemeInput(false);
    }
  };

  const handleRenameTheme = (id: string) => {
    if (editingThemeName.trim()) {
      onRenameTheme(id, editingThemeName.trim());
      setEditingThemeId(null);
    }
  };

  const handleAddTag = (themeId: string) => {
    const tagName = newTagNames[themeId];
    if (tagName?.trim()) {
      onAddTag(themeId, tagName.trim());
      setNewTagNames({ ...newTagNames, [themeId]: '' });
    }
  };

  const handleRenameTag = (themeId: string, oldTag: string) => {
    if (editingTagName.trim() && editingTagName !== oldTag) {
      onRenameTag(themeId, oldTag, editingTagName.trim());
    }
    setEditingTag(null);
  };

  const confirmDeleteTheme = (id: string) => {
    if (window.confirm("This will move its tags to Unassigned. Continue?")) {
      onDeleteTheme(id);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Tag size={24} />
          Tag Management
        </h2>
        
        {showNewThemeInput ? (
          <form onSubmit={handleCreateTheme} className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={newThemeName}
              onChange={(e) => setNewThemeName(e.target.value)}
              placeholder="Theme name..."
              className="px-3 py-1 border rounded focus:outline-none focus:ring-1"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
            <button
              type="submit"
              className="px-4 py-1 rounded text-white cursor-pointer"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewThemeInput(false)}
              className="p-1 px-2 border rounded cursor-pointer"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
            >
              <X size={20} />
            </button>
          </form>
        ) : (
          <button
            onClick={() => setShowNewThemeInput(true)}
            className="flex items-center gap-2 px-4 py-2 rounded text-white font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <Plus size={20} />
            New Theme
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {themes.map((theme) => {
          const isLocked = theme.id === 'seed-portfolio-theme';
          return (
            <div
              key={theme.id}
              className="p-6 rounded-lg border shadow-sm"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <div className="flex justify-between items-start mb-4">
                {editingThemeId === theme.id ? (
                  <div className="flex gap-2 flex-grow">
                    <input
                      type="text"
                      autoFocus
                      value={editingThemeName}
                      onChange={(e) => setEditingThemeName(e.target.value)}
                      className="flex-grow px-2 py-1 border rounded text-lg font-semibold"
                      style={{ borderColor: 'var(--color-primary)' }}
                      onBlur={() => handleRenameTheme(theme.id)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRenameTheme(theme.id)}
                    />
                  </div>
                ) : (
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                    {theme.name}
                  </h3>
                )}
                
                {!isLocked && (
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => {
                        setEditingThemeId(theme.id);
                        setEditingThemeName(theme.name);
                      }}
                      className="p-1.5 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => confirmDeleteTheme(theme.id)}
                      className="p-1.5 rounded-md hover:bg-red-50 text-red-500 transition-colors cursor-pointer"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {theme.tags.map((tag) => {
                  const isAllMf = tag === 'All MF';
                  const isTagLocked = isLocked && isAllMf;
                  
                  return (
                    <div
                      key={tag}
                      className="flex items-center gap-2"
                    >
                      <div
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)' }}
                      >
                        {editingTag?.themeId === theme.id && editingTag?.tag === tag ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingTagName}
                            onChange={(e) => setEditingTagName(e.target.value)}
                            className="w-24 bg-transparent focus:outline-none"
                            onBlur={() => handleRenameTag(theme.id, tag)}
                            onKeyDown={(e) => e.key === 'Enter' && handleRenameTag(theme.id, tag)}
                          />
                        ) : (
                          <span
                            className={cn(
                              !isTagLocked && "cursor-pointer hover:underline"
                            )}
                            onClick={() => {
                              if (!isTagLocked) {
                                setEditingTag({ themeId: theme.id, tag });
                                setEditingTagName(tag);
                              }
                            }}
                            style={{ color: 'var(--color-text)' }}
                          >
                            {tag}
                          </span>
                        )}
                        {!isTagLocked && (
                          <button
                            onClick={() => onDeleteTag(theme.id, tag)}
                            className="ml-1 hover:text-red-500 cursor-pointer"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      {theme.name === 'Portfolio' && tag === 'All MF' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleSyncAllMf}
                            disabled={syncing}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold transition-all hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                          >
                            <Plus size={12} className={syncing ? 'animate-spin' : ''} />
                            Sync All Folios →
                          </button>
                          {syncResult && (
                            <span className={cn(
                              "text-[10px] font-bold",
                              syncResult.assigned === -1 ? "text-red-500" : "text-emerald-500"
                            )}>
                              {syncResult.assigned === -1 
                                ? "Sync failed" 
                                : `✓ ${syncResult.assigned} assigned, ${syncResult.skipped} skipped`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                
                {!isLocked && (
                  <div className="flex items-center ml-2 border rounded-full px-3 py-1" style={{ borderColor: 'var(--color-border)' }}>
                    <input
                      type="text"
                      placeholder="+ add tag"
                      className="text-sm bg-transparent focus:outline-none w-20"
                      value={newTagNames[theme.id] || ''}
                      onChange={(e) => setNewTagNames({ ...newTagNames, [theme.id]: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag(theme.id)}
                      style={{ color: 'var(--color-text-muted)' }}
                    />
                    {newTagNames[theme.id] && (
                      <button onClick={() => handleAddTag(theme.id)} className="cursor-pointer">
                        <Plus size={14} style={{ color: 'var(--color-primary)' }} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {unassignedTags.length > 0 && (
        <div className="mt-12 p-8 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            Unassigned Tags
            <span className="text-sm font-normal px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text-muted)' }}>
              {unassignedTags.length}
            </span>
          </h3>
          
          <div className="flex flex-wrap gap-3">
            {unassignedTags.map((tag) => (
              <div
                key={tag}
                className="flex items-center gap-2 px-4 py-2 rounded-full border shadow-sm"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
              >
                <span className="font-medium text-sm">{tag}</span>
                <button
                  onClick={() => onDeleteUnassignedTag(tag)}
                  className="p-0.5 hover:bg-red-50 rounded-full transition-colors text-red-500 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
