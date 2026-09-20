import {memo,useEffect,useRef,useState,type ReactElement,type ReactNode} from 'react';
import {getVisibleWindow} from '../shared/textMapping';

interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  overscan?: number;
  /**
   * Render must be a pure function of `item`: recycled rows get new props
   * (including fresh highlight ranges) and must never retain per-row state
   * from the item previously shown at that DOM position.
   */
  renderRow:(item:T,index:number)=>ReactNode;
  rowKey:(item:T,index:number)=>string;
  emptyLabel?: string;
}

interface WindowState {
  startIndex:number;
  endIndex:number;
  offset:number;
}

function VirtualListInner<T>({items,rowHeight,overscan=4,renderRow,rowKey,emptyLabel='No results'}:VirtualListProps<T>){
  const viewportRef=useRef<HTMLDivElement>(null);
  const [win,setWin]=useState<WindowState>(()=>({startIndex:0,endIndex:Math.min(items.length,20),offset:0}));

  useEffect(()=>{
    const el=viewportRef.current;
    if(!el)return;
    const update=()=>{
      setWin(getVisibleWindow(el.scrollTop,el.clientHeight,items.length,rowHeight,overscan));
    };
    update();
    el.addEventListener('scroll',update,{passive:true});
    const observer=new ResizeObserver(update);
    observer.observe(el);
    return ()=>{el.removeEventListener('scroll',update);observer.disconnect()};
  },[items.length,rowHeight,overscan]);

  // Keep the window valid when data shrinks (new query, filter change);
  // without this a recycled row could momentarily render stale props.
  useEffect(()=>{
    setWin(previous=>{
      const endIndex=Math.min(previous.endIndex,items.length);
      const startIndex=Math.min(previous.startIndex,Math.max(0,endIndex-1));
      return startIndex===previous.startIndex&&endIndex===previous.endIndex
        ? previous
        : {startIndex,endIndex,offset:startIndex*rowHeight};
    });
  },[items.length,rowHeight]);

  const visible=items.slice(win.startIndex,win.endIndex);

  return (
    <div className="virtual-viewport" ref={viewportRef} role="list" aria-rowcount={items.length}>
      <div className="virtual-spacer" style={{height:items.length*rowHeight,position:'relative'}}>
        <div className="virtual-rows" style={{transform:`translateY(${win.offset}px)`}}>
          {visible.map((item,i)=>{
            const absoluteIndex=win.startIndex+i;
            return (
              <div className="virtual-row" role="listitem" aria-rowindex={absoluteIndex+1} key={rowKey(item,absoluteIndex)} style={{height:rowHeight}}>
                {renderRow(item,absoluteIndex)}
              </div>
            );
          })}
          {items.length===0&&<div className="virtual-empty">{emptyLabel}</div>}
        </div>
      </div>
    </div>
  );
}

export const VirtualList=memo(VirtualListInner) as <T>(props:VirtualListProps<T>)=>ReactElement;
