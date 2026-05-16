"use client";

interface Props {
  label: string;
  addLabel: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}

export function StringListEditor({ label, addLabel, placeholder, values, onChange }: Props) {
  const updateAt = (i: number, v: string) => {
    const arr = values.slice();
    arr[i] = v;
    onChange(arr);
  };
  const removeAt = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const append = () => onChange([...values, ""]);

  return (
    <section className="string-list-editor">
      <label className="field-label">{label}</label>
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
    </section>
  );
}
