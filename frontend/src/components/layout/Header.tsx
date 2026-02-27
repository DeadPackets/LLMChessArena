import { NavLink } from "react-router-dom";

export default function Header() {
  return (
    <header className="app-header">
      <NavLink to="/" className="app-header__logo">
        <span className="app-header__logo-icon">&#9816;</span>
        LLM Chess Arena
      </NavLink>
      <nav className="app-header__nav">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `app-header__link${isActive ? " app-header__link--active" : ""}`
          }
        >
          Games
        </NavLink>
        <NavLink
          to="/leaderboard"
          className={({ isActive }) =>
            `app-header__link${isActive ? " app-header__link--active" : ""}`
          }
        >
          Leaderboard
        </NavLink>
        <NavLink
          to="/openings"
          className={({ isActive }) =>
            `app-header__link${isActive ? " app-header__link--active" : ""}`
          }
        >
          Openings
        </NavLink>
        <NavLink
          to="/head-to-head"
          className={({ isActive }) =>
            `app-header__link${isActive ? " app-header__link--active" : ""}`
          }
        >
          H2H
        </NavLink>
        <NavLink
          to="/costs"
          className={({ isActive }) =>
            `app-header__link${isActive ? " app-header__link--active" : ""}`
          }
        >
          Costs
        </NavLink>
      </nav>
    </header>
  );
}
