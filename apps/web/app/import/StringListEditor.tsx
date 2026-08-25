"use client";

interface Props {
  label: string;
  addLabel: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  collapsed?: boolean;
}

export function StringListEditor({ label, addLabel, placeholder, values, onChange, collapsed = false }: Props) {
  const updateAt = (i: number, v: string) => {
    const arr = values.slice();
    arr[i] = v;
    onChange(arr);
  };
  const removeAt = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const append = () => onChange([...values, ""]);

  const contents = (
    <>
      <ul>
        {values.map((v, i) => (
          <li key={i} className="string-row">
            <input
              type="text"
              placeholder={placeholder}
              value={v}
              onChange={(e) => updateAt(i, e.target.value)}
            />
            <button type="button" onClick={() => removeAt(i)} aria-label="remove">×</button>
          </li>
        ))}
      </ul>
      <button type="button" className="add-row-btn" onClick={append}>+ {addLabel}</button>
    </>
  );

  if (collapsed) {
    return (
      <details className="string-list-editor">
        <summary>{label}{values.length ? ` (${values.length})` : ""}</summary>
        {contents}
      </details>
    );
  }

  return <section className="string-list-editor"><label className="field-label">{label}</label>{contents}</section>;
}
