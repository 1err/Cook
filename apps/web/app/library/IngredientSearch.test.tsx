import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { IngredientSearch } from "./IngredientSearch";
import { RemainingIngredients } from "./RemainingIngredients";
vi.mock("next/navigation",()=>({usePathname:()=>"/library"}));
afterEach(cleanup);
const options=[{id:"chicken",en:"Chicken",zh:"鸡肉",aliases:["chicken","鸡肉","鸡胸肉"]},{id:"chicken stock",en:"Chicken stock",zh:"鸡汤",aliases:["chicken stock","chicken broth","鸡汤"]}];
test("Chinese alias selection emits the chicken identity, not its typed alias",async()=>{
 const select=vi.fn();render(<I18nProvider><IngredientSearch options={options} selected={[]} onAdd={select} /></I18nProvider>);
 await userEvent.type(screen.getByRole("combobox"),"鸡胸肉");
 await userEvent.keyboard("{ArrowDown}{Enter}");
 expect(select).toHaveBeenCalledWith("chicken");
});
test("unknown ingredients stay searchable and already-selected aliases cannot duplicate a chip",async()=>{
 const select=vi.fn();const rendered=render(<I18nProvider><IngredientSearch options={options} selected={[]} onAdd={select} /></I18nProvider>);
 await userEvent.type(screen.getByRole("combobox"),"strawberry{Enter}");expect(select).toHaveBeenLastCalledWith("strawberry");
 rendered.rerender(<I18nProvider><IngredientSearch options={options} selected={["chicken"]} onAdd={select} /></I18nProvider>);
 select.mockClear();await userEvent.type(screen.getByRole("combobox"),"鸡肉{Enter}");expect(select).not.toHaveBeenCalled();
});
test("the remaining names open on focus or tap and Escape/outside interaction dismisses them",async()=>{
 render(<I18nProvider><RemainingIngredients names={["garlic","ginger","salt","oil","spring onion"]} options={[]} title="Soup" /></I18nProvider>);
 const button=screen.getByRole("button",{name:/5 more ingredients/});
 fireEvent.focus(button);expect(screen.getByRole("tooltip")).toHaveTextContent("spring onion");
 fireEvent.keyDown(document,{key:"Escape"});expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
 fireEvent.click(button);expect(screen.getByRole("tooltip")).toHaveTextContent("garlic");
 fireEvent.pointerDown(document.body);expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
