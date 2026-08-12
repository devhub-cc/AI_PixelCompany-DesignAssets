import { createRoot } from "react-dom/client";
import { DemoApp } from "./DemoApp";
import "./globals.css";
import "./demo.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
createRoot(root).render(<DemoApp />);
