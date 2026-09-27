import React, { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMenuDraft, menuDesignForStyle, MESSAGE_MAP, type MenuDraft } from '@cooking/shared';
import { MenuDesignControls } from './MenuDesignControls';
const mocks=vi.hoisted(()=>({generate:vi.fn()}));
vi.mock('../../lib/auth',()=>({useAuth:()=>({user:{id:'account'}})}));
vi.mock('../../lib/api',()=>({webApiClient:{menus:{generateDesign:mocks.generate}}}));
vi.mock('../../lib/i18n',()=>({useI18n:()=>({language:'en',t:(key:string)=>MESSAGE_MAP.en[key]??key})}));
function Editor(){const[draft,setDraft]=useState<MenuDraft>(()=>createMenuDraft([{id:'one',title:'Original dish'}],['one'],{title:'Dinner',section:'Dishes'}));return <><MenuDesignControls draft={draft} creationId="session-id" photoCount={1} onChange={setDraft}/><input aria-label="Local title" value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/><output data-testid="draft">{JSON.stringify(draft)}</output></>;}
const current=()=>JSON.parse(screen.getByTestId('draft').textContent!);
beforeEach(()=>{mocks.generate.mockReset();});afterEach(cleanup);
it('changes composition independently of color and keeps hidden descriptions intact',async()=>{
 const user=userEvent.setup();render(<Editor/>);
 await user.click(screen.getByRole('button',{name:'Category board'}));expect(current().design.columns).toBe(3);
 await user.click(screen.getByRole('button',{name:'Garden table'}));expect(current().design.layout).toBe('category-board');
 await user.click(screen.getByRole('button',{name:'Illustrated list'}));expect(current().design.columns).toBe(1);
 await user.click(screen.getByLabelText('Show dish descriptions'));expect(current().design.show_descriptions).toBe(false);expect(current().items[0].name).toBe('Original dish');
});
it('applies an AI suggestion only explicitly, retaining text edited while waiting',async()=>{
 let finish!:(value:unknown)=>void;mocks.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const user=userEvent.setup();render(<Editor/>);
 await user.type(screen.getByLabelText('Describe your menu'),'A garden lunch');await user.click(screen.getByRole('button',{name:/Design with AI/}));
 await user.clear(screen.getByLabelText('Local title'));await user.type(screen.getByLabelText('Local title'),'My edited title');
 finish(menuDesignForStyle('garden-table'));await waitFor(()=>expect(screen.getByRole('button',{name:'Use this design'})).toBeVisible());
 expect(current().design.layout).toBe('photo-grid');
 await user.click(screen.getByRole('button',{name:'Use this design'}));expect(current().design.layout).toBe('illustrated-list');expect(current().title).toBe('My edited title');expect(current().items[0].name).toBe('Original dish');
 expect(mocks.generate.mock.calls[0][0]).toMatchObject({menu_creation_id:'session-id',content:{photo_count:1}});
});
