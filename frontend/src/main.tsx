import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { PetAnimationLab } from "./features/pet-lab/PetAnimationLab";
import "./styles/atelier.css";
import "./styles/code-highlighting.css";
import "./styles/pet-animations.css";
import "./styles/resource-workshop.css";

const showPetLab = new URLSearchParams(window.location.search).get("petLab") === "1";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {showPetLab ? <PetAnimationLab /> : <App />}
  </StrictMode>,
);
