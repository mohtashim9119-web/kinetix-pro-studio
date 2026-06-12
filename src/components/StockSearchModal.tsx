/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Plus, RefreshCw, Video, Image as ImageIcon, AlertCircle, Clock } from 'lucide-react';
import { searchAllStock, StockResult, StockSearchResult } from '../services/stockService';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface Props {
  targetSegmentId: string | null;
  onClose: () => void;
  onSelect: (stock: StockResult, targetSegmentId: string | null) => void;
}

export function StockSearchModal({ targetSegmentId, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [mediaType, setMediaType] = useState<'video' | 'image'>('video');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<StockSearchResult | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length > 2) {
        setIsSearching(true);
        const result = await searchAllStock(query, mediaType);
        setSearchResult(result);
        setIsSearching(false);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [query, mediaType]);

  const results = searchResult?.status === 'ok' ? searchResult.results : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/90 backdrop-blur-xl"
      />
      <motion.div
        initial={{ scale: 0.9, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, y: 20, opacity: 0 }}
        ref={trapRef}
        className="relative w-full max-w-4xl bg-[#0A0A0A] border border-[#1A1A1A] rounded-[40px] shadow-2xl overflow-hidden flex flex-col h-[80vh]"
      >
        <div className="p-8 border-b border-[#1A1A1A] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-500 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Video size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Stock Library</h2>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Pexels · Pixabay · Coverr</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close stock library"
            className="p-3 hover:bg-[#1A1A1A] rounded-2xl transition-colors text-gray-500 hover:text-white"
          >
            <Plus size={24} className="rotate-45" />
          </button>
        </div>

        <div className="p-8 space-y-8 flex-1 overflow-y-auto custom-scrollbar">
          <div className="relative group">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIsSearching(true);
                setTimeout(() => setIsSearching(false), 500);
              }}
              placeholder="Search high-quality stock footage (e.g. 'abstract technology', 'nature 4k')..."
              className="w-full bg-[#121212] border border-[#282828] p-6 rounded-[24px] text-lg font-medium outline-none focus:border-blue-500/50 transition-all shadow-inner"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-blue-500 text-white rounded-xl">
              {isSearching ? <RefreshCw size={20} className="animate-spin" /> : <Plus size={20} className="rotate-45" />}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setMediaType('video')}
              className={`p-4 rounded-2xl border transition-all flex items-center justify-center gap-3 ${mediaType === 'video' ? 'bg-blue-500 border-blue-400 font-bold' : 'bg-[#1A1A1A] border-white/5 text-gray-400'}`}
            >
              <Video size={18} />
              Videos
            </button>
            <button
              onClick={() => setMediaType('image')}
              className={`p-4 rounded-2xl border transition-all flex items-center justify-center gap-3 ${mediaType === 'image' ? 'bg-blue-500 border-blue-400 font-bold' : 'bg-[#1A1A1A] border-white/5 text-gray-400'}`}
            >
              <ImageIcon size={18} />
              Images
            </button>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {results.length > 0 ? results.map(stock => (
              <div
                key={stock.id}
                className="group relative aspect-video rounded-3xl overflow-hidden border border-[#1A1A1A] cursor-pointer hover:border-blue-500 transition-all bg-black"
                onClick={() => {
                  onSelect(stock, targetSegmentId);
                  onClose();
                }}
              >
                {stock.type === 'video' ? (
                  <div className="w-full h-full relative">
                    <video
                      src={stock.url}
                      className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                      muted
                      loop
                      onMouseOver={(e) => (e.target as HTMLVideoElement).play()}
                      onMouseOut={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                    />
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 rounded text-[8px] font-bold text-white uppercase">{stock.provider}</div>
                  </div>
                ) : (
                  <div className="w-full h-full relative">
                    <img src={stock.url} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" alt={stock.name} />
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 rounded text-[8px] font-bold text-white uppercase">{stock.provider}</div>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white">{stock.name}</span>
                  <span className="text-[8px] text-blue-400 font-bold uppercase tracking-wide">Add to Scene</span>
                </div>
              </div>
            )) : (
              <div className="col-span-3 py-20 text-center space-y-4">
                {searchResult?.status === 'rate_limited' ? (
                  <>
                    <Clock size={32} className="mx-auto text-yellow-600" />
                    <p className="text-yellow-500 uppercase text-[10px] font-black tracking-widest">
                      Rate limited — please try again in a moment
                    </p>
                  </>
                ) : searchResult?.status === 'error' ? (
                  <>
                    <AlertCircle size={32} className="mx-auto text-red-800" />
                    <p className="text-red-500 uppercase text-[10px] font-black tracking-widest">
                      Search failed — check your connection and try again
                    </p>
                  </>
                ) : (
                  <>
                    <AlertCircle size={32} className="mx-auto text-gray-800" />
                    <p className="text-gray-500 uppercase text-[10px] font-black tracking-widest">
                      {query.length > 2
                        ? `No stock media found for "${query}"`
                        : 'Type at least 3 characters to search'}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
