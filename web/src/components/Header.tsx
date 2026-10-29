import logo from '../assets/shapes-logo.png';

export function Header() {
  return (
    <header>
      <img className="logo" src={logo} alt="Shapes" />
      <span className="title">People Chat</span>
    </header>
  );
}
