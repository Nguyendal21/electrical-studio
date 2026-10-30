/** Direction only: this arc does not imply a measured shaft speed. */
export function MotorDirection({x,y,direction,moving=false}:{x:number;y:number;direction:number;moving?:boolean}){
  if(!direction)return null;
  const reverse=direction<0;
  const label=reverse?'Quay ngược chiều kim đồng hồ':'Quay theo chiều kim đồng hồ';
  return <g className="motor-direction" data-direction={reverse?'counterclockwise':'clockwise'} data-moving={moving?'true':'false'} role="img" aria-label={label} pointerEvents="none" transform={`translate(${x} ${y})${reverse?' scale(-1 1)':''}`}>
    <title>{label}</title>
    <path d="M-14 -18Q0 -30 14 -18 M8 -19L14 -18L13 -24"/>
  </g>;
}
