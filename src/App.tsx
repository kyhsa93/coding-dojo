import { Link, Route, Routes } from "react-router-dom";
import ProblemList from "./pages/ProblemList";
import ProblemPage from "./pages/ProblemPage";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Coding Dojo
        </Link>
        <a className="muted" href="https://github.com/kyhsa93/coding-dojo" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>
      <Routes>
        <Route path="/" element={<ProblemList />} />
        <Route path="/p/:id" element={<ProblemPage />} />
        <Route path="*" element={<main className="page"><p>페이지를 찾을 수 없습니다.</p></main>} />
      </Routes>
    </div>
  );
}
