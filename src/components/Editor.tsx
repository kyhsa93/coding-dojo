import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import type { Language } from "../lib/types";

interface Props {
  language: Language;
  value: string;
  onChange: (v: string) => void;
}

export default function Editor({ language, value, onChange }: Props) {
  const extensions = useMemo(() => {
    if (language === "python") return [python()];
    return [javascript({ typescript: language === "typescript" })];
  }, [language]);
  return (
    <CodeMirror
      value={value}
      height="100%"
      theme="dark"
      extensions={extensions}
      onChange={onChange}
      basicSetup={{ tabSize: 2, lineNumbers: true, foldGutter: false }}
      className="editor"
    />
  );
}
