'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search, Loader2, MapPin } from 'lucide-react';
import {
  searchPlaces,
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  type PlaceSuggestion,
  type SearchBias,
} from '../utils/placeSearch';

export interface PlaceSearchBoxProps {
  /** Called with the chosen place's coordinates. */
  onSelect: (latitude: number, longitude: number, label: string) => void;
  /** Optional area to bias results toward, e.g. the creator's own position. */
  bias?: SearchBias | null;
  placeholder?: string;
  id?: string;
}

/**
 * Free-text place search for the creator's placement picker.
 *
 * Debounced, keyboard-navigable, and deliberately provider-agnostic: it talks
 * to `searchPlaces`, which picks Google Places or keyless Nominatim. The map
 * component is what reacts to the resulting coordinates, so this works
 * identically whether Google or Leaflet is rendering.
 *
 * Follows the WAI-ARIA combobox pattern: the input owns a listbox and tracks the
 * active option with `aria-activedescendant`.
 */
export function PlaceSearchBox({
  onSelect,
  bias,
  placeholder = 'Search for a place…',
  id,
}: PlaceSearchBoxProps) {
  const reactId = useId();
  const listboxId = `${id ?? reactId}-listbox`;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement | null>(null);
  // Guards against an earlier, slower request overwriting a newer one's results.
  const requestSeq = useRef(0);

  // Bias is read through a ref so a moving GPS fix does not restart the debounce
  // timer mid-typing.
  const biasRef = useRef(bias);
  biasRef.current = bias;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Debounced search; the timer is reset on every keystroke.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const found = await searchPlaces(trimmed, biasRef.current ?? undefined);
      // A newer keystroke has already superseded this request.
      if (seq !== requestSeq.current) return;
      setResults(found);
      setActiveIndex(found.length > 0 ? 0 : -1);
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Close the list when a click lands outside the widget.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const choose = (suggestion: PlaceSuggestion) => {
    setQuery('');
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    onSelectRef.current(suggestion.latitude, suggestion.longitude, suggestion.title);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setActiveIndex((i) => {
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        // Wrap around, so holding a direction cycles rather than sticking.
        return (i + delta + results.length) % results.length;
      });
      return;
    }
    if (e.key === 'Enter') {
      const picked = results[activeIndex];
      if (open && picked) {
        e.preventDefault();
        choose(picked);
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const expanded = open && query.trim().length >= MIN_QUERY_LENGTH;
  const showEmptyState = expanded && !loading && results.length === 0;

  return (
    <div className="placeSearch" ref={rootRef}>
      <div className="placeSearchField">
        <Search size={15} className="placeSearchIcon" aria-hidden="true" />
        <input
          id={id}
          className="input placeSearchInput"
          type="text"
          value={query}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {loading && <Loader2 size={15} className="placeSearchSpinner" aria-label="Searching" />}
      </div>

      {expanded && (
        <ul className="placeSearchResults" id={listboxId} role="listbox">
          {results.map((suggestion, i) => (
            <li
              key={suggestion.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={`placeSearchResult${i === activeIndex ? ' isActive' : ''}`}
              // `onMouseDown` fires before the input's blur, so the click is not
              // lost to the list closing underneath the pointer.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(suggestion);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <MapPin size={14} className="placeSearchPin" aria-hidden="true" />
              <span className="placeSearchText">
                <span className="placeSearchTitle">{suggestion.title}</span>
                {suggestion.subtitle && (
                  <span className="placeSearchSubtitle">{suggestion.subtitle}</span>
                )}
              </span>
            </li>
          ))}
          {showEmptyState && (
            <li className="placeSearchEmpty" role="presentation">
              No places found
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

