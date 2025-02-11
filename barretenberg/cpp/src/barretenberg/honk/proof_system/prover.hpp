#pragma once
#include "barretenberg/honk/flavor/standard.hpp"
#include "barretenberg/honk/flavor/standard_grumpkin.hpp"
#include "barretenberg/honk/instance/prover_instance.hpp"
#include "barretenberg/honk/pcs/gemini/gemini.hpp"
#include "barretenberg/honk/pcs/shplonk/shplonk.hpp"
#include "barretenberg/honk/proof_system/work_queue.hpp"
#include "barretenberg/honk/sumcheck/sumcheck.hpp"
#include "barretenberg/honk/sumcheck/sumcheck_output.hpp"
#include "barretenberg/honk/transcript/transcript.hpp"
#include "barretenberg/plonk/proof_system/types/proof.hpp"

namespace proof_system::honk {

// We won't compile this class with honk::flavor::Ultra, but we will like want to compile it (at least for testing)
// with a flavor that uses the curve Grumpkin, or a flavor that does/does not have zk, etc.
template <StandardFlavor Flavor> class StandardProver_ {

    using FF = typename Flavor::FF;
    using ProvingKey = typename Flavor::ProvingKey;
    using Polynomial = typename Flavor::Polynomial;
    using ProverPolynomials = typename Flavor::ProverPolynomials;
    using CommitmentLabels = typename Flavor::CommitmentLabels;
    using CommitmentKey = typename Flavor::CommitmentKey;
    using PCS = typename Flavor::PCS;
    using Curve = typename Flavor::Curve;
    using Instance = ProverInstance_<Flavor>;

  public:
    explicit StandardProver_(std::shared_ptr<Instance>);
    void execute_preamble_round();
    void execute_wire_commitments_round();
    void execute_tables_round();
    void execute_grand_product_computation_round();
    void execute_relation_check_rounds();
    void execute_univariatization_round();
    void execute_pcs_evaluation_round();
    void execute_shplonk_batched_quotient_round();
    void execute_shplonk_partial_evaluation_round();

    void execute_final_pcs_round();

    void compute_wire_commitments();

    void construct_prover_polynomials();

    plonk::proof& export_proof();
    plonk::proof& construct_proof();

    ProverTranscript<FF> transcript;

    std::vector<FF> public_inputs;

    CommitmentLabels commitment_labels;

    // Container for d + 1 Fold polynomials produced by Gemini
    std::vector<Polynomial> gemini_polynomials;

    Polynomial batched_quotient_Q; // batched quotient poly computed by Shplonk
    FF nu_challenge;               // needed in both Shplonk rounds

    Polynomial quotient_W;

    work_queue<Curve> queue;

    std::shared_ptr<Instance> instance;

    sumcheck::SumcheckOutput<Flavor> sumcheck_output;
    pcs::gemini::ProverOutput<Curve> gemini_output;
    pcs::shplonk::ProverOutput<Curve> shplonk_output;
    std::shared_ptr<CommitmentKey> pcs_commitment_key;

    using Gemini = pcs::gemini::GeminiProver_<Curve>;
    using Shplonk = pcs::shplonk::ShplonkProver_<Curve>;

  private:
    plonk::proof proof;
};

extern template class StandardProver_<honk::flavor::Standard>;
extern template class StandardProver_<honk::flavor::StandardGrumpkin>;

using StandardProver = StandardProver_<honk::flavor::Standard>;
// using GrumpkinStandardProver = StandardProver_<honk::flavor::StandardGrumpkin>; // e.g.

} // namespace proof_system::honk
