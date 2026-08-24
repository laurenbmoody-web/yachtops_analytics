import './LogoSpinner.css';

export default function LogoSpinner({ size = 32, className = '' }) {
  return (
    <img
      src="/cargo-mark.png"
      alt=""
      aria-hidden="true"
      className={`logo-spin${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, display: 'block' }}
    />
  );
}
