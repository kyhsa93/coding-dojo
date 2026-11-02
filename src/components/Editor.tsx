import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { python, pythonLanguage } from "@codemirror/lang-python";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { jsGlobalCompletion, jsMemberCompletion, pyMemberCompletion } from "../lib/completions";
import type { Language } from "../lib/types";

interface Props {
  language: Language;
  value: string;
  onChange: (v: string) => void;
}

/**
 * IDE-style completion: pops up while typing, Tab or Enter accepts, Escape closes. The language's own
 * sources (local names, keyword snippets, Python builtins) stay on; ours add globals and members.
 */
const completionExtensions = [
  autocompletion({ activateOnTyping: true, maxRenderedOptions: 40, defaultKeymap: true }),
  closeBrackets(),
  keymap.of([...closeBracketsKeymap, ...completionKeymap]),
  Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
  EditorView.contentAttributes.of({ "aria-label": "코드 편집기" }),
];

const jsCompletions = javascriptLanguage.data.of({ autocomplete: jsGlobalCompletion });
const jsMembers = javascriptLanguage.data.of({ autocomplete: jsMemberCompletion });
const pyMembers = pythonLanguage.data.of({ autocomplete: pyMemberCompletion });

export default function Editor({ language, value, onChange }: Props) {
  const extensions = useMemo(() => {
    if (language === "python") return [python(), pyMembers, ...completionExtensions];
    return [javascript({ typescript: language === "typescript" }), jsCompletions, jsMembers, ...completionExtensions];
  }, [language]);
  return (
    <CodeMirror
      value={value}
      height="100%"
      theme="dark"
      extensions={extensions}
      onChange={onChange}
      basicSetup={{ tabSize: 2, lineNumbers: true, foldGutter: false, autocompletion: false, closeBrackets: false, closeBracketsKeymap: false, completionKeymap: false }}
      className="editor"
    />
  );
}
