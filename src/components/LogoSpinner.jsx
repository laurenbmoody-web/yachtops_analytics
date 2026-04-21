export default function LogoSpinner({ size = 32, className = '' }) {
  return (
    <img
      src="/logo-spinner.svg"
      alt=""
      aria-hidden="true"
      className={`animate-spin${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, animationDuration: '6s', display: 'block' }}
    />
  );
}
