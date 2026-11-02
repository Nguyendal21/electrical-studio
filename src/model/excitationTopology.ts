type Pair=readonly [string,string];

// Parallel branches need two separate terminal paths. A common return alone
// is insufficient, even when the passive graph contains cycles around it.
export function parallelTerminalPaths(edges:readonly Pair[],a:Pair,b:Pair):boolean{
  if(a[0]===a[1]||b[0]===b[1])return false;
  const nodes=new Map<string,number>();
  for(const node of [...a,...b,...edges.flat()])if(!nodes.has(node))nodes.set(node,nodes.size);
  type Edge={to:number,reverse:number,capacity:number};
  const source=nodes.size*2,sink=source+1;
  const graph:Edge[][]=Array.from({length:sink+1},()=>[]);
  const add=(from:number,to:number)=>{
    graph[from].push({to,reverse:graph[to].length,capacity:1});
    graph[to].push({to:from,reverse:graph[from].length-1,capacity:0});
  };
  const input=(node:string)=>nodes.get(node)!*2;
  for(const index of nodes.values())add(index*2,index*2+1);
  for(const [from,to] of edges)if(from!==to){add(input(from)+1,input(to));add(input(to)+1,input(from));}
  for(const node of a)add(source,input(node));
  for(const node of b)add(input(node)+1,sink);
  // Unit capacity through each split vertex enforces vertex-disjoint paths;
  // residual edges let the second search reroute the first path if necessary.
  for(let flow=0;flow<2;flow++){
    const parent=Array<number>(graph.length).fill(-1),via=Array<number>(graph.length).fill(-1);
    const queue=[source];parent[source]=source;
    for(let head=0;head<queue.length&&parent[sink]===-1;head++){
      const node=queue[head];
      for(let index=0;index<graph[node].length;index++){
        const edge=graph[node][index];
        if(edge.capacity&&parent[edge.to]===-1){parent[edge.to]=node;via[edge.to]=index;queue.push(edge.to);}
      }
    }
    if(parent[sink]===-1)return false;
    for(let node=sink;node!==source;node=parent[node]){
      const edge=graph[parent[node]][via[node]];
      edge.capacity--;graph[node][edge.reverse].capacity++;
    }
  }
  return true;
}
