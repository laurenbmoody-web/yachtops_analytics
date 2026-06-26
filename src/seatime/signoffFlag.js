// Single switch for the (now parked) in-Cargo captain sign-off / "verification".
//
// Under the real MCA process the master signs ONCE — on the PYA/Nautilus printed
// testimonial the org issues — and PYA/Nautilus are the MCA-delegated verifiers
// (MIN 543), not Cargo. A Cargo signature before that export is redundant and
// makes the master sign twice, so the sign-off ceremony, the captain's reviews
// queue, and the "captain-verified" pack are all hidden and unlinked from the
// sea-service log. Cargo's role: log the service accurately and export it for the
// org to verify. Flip to true only if we revive an in-app endorsement use case.
export const SHOW_SIGNOFF = false;
