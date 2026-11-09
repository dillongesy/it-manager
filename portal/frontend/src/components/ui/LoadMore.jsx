import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Footer for an endless-scroll list: pulls the next page automatically as it
 * scrolls into view, and always states where you are ("Showing 100 of 312").
 *
 * The explicit button stays for anyone who'd rather click, and is the fallback
 * where IntersectionObserver never fires - e.g. a short list inside a container
 * that doesn't scroll.
 */
export function LoadMore({ query, loaded, total, noun = 'row', className = '' }) {
  const sentinel = useRef(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !isFetchingNextPage) fetchNextPage(); },
      // Start loading a little before the end so scrolling doesn't visibly stall.
      { rootMargin: '400px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!total) return null;

  const plural = total === 1 ? noun : `${noun}s`;

  return (
    <div ref={sentinel} className={`flex flex-col items-center gap-2 py-4 ${className}`}>
      <p className="text-gray-500 text-xs">
        {hasNextPage
          ? `Showing ${loaded} of ${total.toLocaleString()} ${plural}`
          : `${total.toLocaleString()} ${plural}`}
      </p>
      {isFetchingNextPage ? (
        <span className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading more…
        </span>
      ) : hasNextPage ? (
        <button onClick={() => fetchNextPage()} className="btn-secondary text-sm">
          Load more
        </button>
      ) : null}
    </div>
  );
}
