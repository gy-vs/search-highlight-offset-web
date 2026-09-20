import {memo,useMemo,type ReactElement} from 'react';
import type {Range} from '../shared/textMapping';
import {mergeRanges} from '../shared/textMapping';

interface HighlightTextProps {
  text: string;
  /** Half-open UTF-16 ranges relative to `text`, produced by the server. */
  ranges: Range[];
  className?: string;
}

/**
 * Renders server-provided ranges as <mark>. The client never folds or
 * normalizes text here — ranges already point at original UTF-16 offsets and
 * cover whole source graphemes, so plain slice() calls cannot split
 * surrogate pairs or combining sequences.
 */
function HighlightTextInner({text,ranges,className}:HighlightTextProps){
  const merged=useMemo(()=>mergeRanges(ranges),[ranges]);
  const parts:ReactElement[]=[];
  let cursor=0;
  merged.forEach((range,index)=>{
    const start=Math.max(0,Math.min(range.start,text.length));
    const end=Math.max(start,Math.min(range.end,text.length));
    if(start>cursor)parts.push(<span key={`t${index}`}>{text.slice(cursor,start)}</span>);
    if(end>start)parts.push(<mark key={`m${index}`}>{text.slice(start,end)}</mark>);
    cursor=end;
  });
  if(cursor<text.length)parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <span className={className}>{parts}</span>;
}

export const HighlightText=memo(HighlightTextInner);
