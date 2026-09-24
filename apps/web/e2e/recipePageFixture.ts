/** API-shaped summary fixtures keep browser journeys honest about list/detail separation. */
export function recipePageFixture<T extends {id:string; title:unknown; ingredients?:unknown[]; steps?:unknown[]; library_tags?:string[]; library_category?:string|null}>(rows: T[], url:string) {
  const params=new URL(url).searchParams;
  const q=(params.get('q') ?? '').toLowerCase();
  const tags=params.getAll('tags');
  const items=rows.filter(row => String(row.title).toLowerCase().includes(q) && tags.every(tag => row.library_tags?.includes(tag) || row.library_category===tag))
    .sort((a,b)=>String(a.title).localeCompare(String(b.title)))
    .map(({ingredients,steps,...row})=>({...row,ingredient_count:ingredients?.length??0,step_count:steps?.length??0,already_saved:false}));
  return {items,next_cursor:null};
}
