#include "transcript.hpp"
#include "barretenberg/ecc/curves/bn254/g1.hpp"
#include "barretenberg/honk/composer/standard_composer.hpp"
#include "barretenberg/honk/composer/ultra_composer.hpp"
#include "barretenberg/honk/flavor/standard.hpp"
#include "barretenberg/numeric/bitop/get_msb.hpp"
#include "barretenberg/polynomials/univariate.hpp"
#include "barretenberg/proof_system/flavor/flavor.hpp"
#include <gtest/gtest.h>

using namespace proof_system::honk;

template <typename Flavor> class TranscriptTests : public testing::Test {
  protected:
    // TODO(https://github.com/AztecProtocol/barretenberg/issues/640): The Standard Honk on Grumpkin test suite fails
    // unless the SRS is initialised for every test.
    virtual void SetUp()
    {
        if constexpr (proof_system::IsGrumpkinFlavor<Flavor>) {
            barretenberg::srs::init_grumpkin_crs_factory("../srs_db/grumpkin");
        } else {
            barretenberg::srs::init_crs_factory("../srs_db/ignition");
        }
    };

    using FF = typename Flavor::FF;

    /**
     * @brief Construct a manifest for a standard Honk proof
     *
     * @details This is where we define the "Manifest" for a Standard Honk proof. The tests in this suite are
     * intented to warn the developer if the Prover/Verifier has deviated from this manifest, however, the
     * Transcript class is not otherwise contrained to follow the manifest.
     *
     * @note Entries in the manifest consist of a name string and a size (bytes), NOT actual data.
     *
     * @return TranscriptManifest
     */
    TranscriptManifest construct_standard_honk_manifest(size_t circuit_size)
    {
        TranscriptManifest manifest_expected;

        auto log_n = numeric::get_msb(circuit_size);

        size_t max_relation_length = Flavor::MAX_RANDOM_RELATION_LENGTH;
        size_t size_FF = sizeof(FF);
        size_t size_G = 2 * size_FF;
        size_t size_uni = max_relation_length * size_FF;
        size_t size_evals = (Flavor::NUM_ALL_ENTITIES)*size_FF;
        size_t size_uint32 = 4;
        size_t size_uint64 = 8;

        size_t round = 0;
        manifest_expected.add_entry(round, "circuit_size", size_uint32);
        manifest_expected.add_entry(round, "public_input_size", size_uint32);
        manifest_expected.add_entry(round, "public_input_0", size_FF);
        manifest_expected.add_entry(round, "W_1", size_G);
        manifest_expected.add_entry(round, "W_2", size_G);
        manifest_expected.add_entry(round, "W_3", size_G);
        manifest_expected.add_challenge(round, "beta", "gamma");

        round++;
        manifest_expected.add_entry(round, "Z_PERM", size_G);
        manifest_expected.add_challenge(round, "Sumcheck:alpha", "Sumcheck:zeta");

        for (size_t i = 0; i < log_n; ++i) {
            round++;
            std::string idx = std::to_string(i);
            manifest_expected.add_entry(round, "Sumcheck:univariate_" + idx, size_uni);
            std::string label = "Sumcheck:u_" + idx;
            manifest_expected.add_challenge(round, label);
        }

        round++;
        manifest_expected.add_entry(round, "Sumcheck:evaluations", size_evals);
        manifest_expected.add_challenge(round, "rho");

        round++;
        for (size_t i = 1; i < log_n; ++i) {
            std::string idx = std::to_string(i);
            manifest_expected.add_entry(round, "Gemini:FOLD_" + idx, size_G);
        }
        manifest_expected.add_challenge(round, "Gemini:r");

        round++;
        for (size_t i = 0; i < log_n; ++i) {
            std::string idx = std::to_string(i);
            manifest_expected.add_entry(round, "Gemini:a_" + idx, size_FF);
        }
        manifest_expected.add_challenge(round, "Shplonk:nu");

        round++;
        manifest_expected.add_entry(round, "Shplonk:Q", size_G);
        manifest_expected.add_challenge(round, "Shplonk:z");

        round++;
        // TODO(Mara): Make testing more flavor agnostic so we can test this with all flavors
        if constexpr (proof_system::IsGrumpkinFlavor<Flavor>) {
            manifest_expected.add_entry(round, "IPA:poly_degree", size_uint64);
            manifest_expected.add_challenge(round, "IPA:generator_challenge");

            for (size_t i = 0; i < log_n; i++) {
                round++;
                std::string idx = std::to_string(i);
                manifest_expected.add_entry(round, "IPA:L_" + idx, size_G);
                manifest_expected.add_entry(round, "IPA:R_" + idx, size_G);
                std::string label = "IPA:round_challenge_" + idx;
                manifest_expected.add_challenge(round, label);
            }

            round++;
            manifest_expected.add_entry(round, "IPA:a_0", size_FF);
        } else {
            manifest_expected.add_entry(round, "KZG:W", size_G);
        }

        manifest_expected.add_challenge(round); // no challenge

        return manifest_expected;
    }
};

using StandardFlavorTypes = testing::Types<flavor::Standard, flavor::StandardGrumpkin>;
TYPED_TEST_SUITE(TranscriptTests, StandardFlavorTypes);

/**
 * @brief Ensure consistency between the manifest hard coded in this testing suite and the one generated by the
 * standard honk prover over the course of proof construction.
 */
TYPED_TEST(TranscriptTests, ProverManifestConsistency)
{
    using Flavor = TypeParam;
    // Construct a simple circuit of size n = 8 (i.e. the minimum circuit size)
    typename Flavor::FF a = 1;
    auto builder = typename Flavor::CircuitBuilder();
    builder.add_variable(a);
    builder.add_public_variable(a);

    // Automatically generate a transcript manifest by constructing a proof
    auto composer = StandardComposer_<Flavor>();
    auto instance = composer.create_instance(builder);
    auto prover = composer.create_prover(instance);
    auto proof = prover.construct_proof();

    // Check that the prover generated manifest agrees with the manifest hard coded in this suite
    auto manifest_expected = TestFixture::construct_standard_honk_manifest(instance->proving_key->circuit_size);
    auto prover_manifest = prover.transcript.get_manifest();
    // Note: a manifest can be printed using manifest.print()
    for (size_t round = 0; round < manifest_expected.size(); ++round) {
        ASSERT_EQ(prover_manifest[round], manifest_expected[round]) << "Prover manifest discrepency in round " << round;
    }
}

/**
 * @brief Ensure consistency between the manifest generated by the standard honk prover over the course of proof
 * construction and the one generated by the verifier over the course of proof verification.
 *
 */
TYPED_TEST(TranscriptTests, VerifierManifestConsistency)
{
    using Flavor = TypeParam;
    // Construct a simple circuit of size n = 8 (i.e. the minimum circuit size)
    typename Flavor::FF a = 1;
    auto builder = typename Flavor::CircuitBuilder();
    builder.add_variable(a);
    builder.add_public_variable(a);

    // Automatically generate a transcript manifest in the prover by constructing a proof
    auto composer = StandardComposer_<Flavor>();
    auto instance = composer.create_instance(builder);
    auto prover = composer.create_prover(instance);
    auto proof = prover.construct_proof();

    // Automatically generate a transcript manifest in the verifier by verifying a proof
    auto verifier = composer.create_verifier(instance);
    verifier.verify_proof(proof);
    prover.transcript.print();
    verifier.transcript.print();

    // Check consistency between the manifests generated by the prover and verifier
    auto prover_manifest = prover.transcript.get_manifest();
    auto verifier_manifest = verifier.transcript.get_manifest();

    // Note: a manifest can be printed using manifest.print()
    for (size_t round = 0; round < prover_manifest.size(); ++round) {
        ASSERT_EQ(prover_manifest[round], verifier_manifest[round])
            << "Prover/Verifier manifest discrepency in round " << round;
    }
}

/**
 * @brief Test and demonstrate the basic functionality of the prover and verifier transcript
 *
 */
TYPED_TEST(TranscriptTests, ProverAndVerifierBasic)
{
    constexpr size_t LENGTH = 8;

    using Fr = barretenberg::fr;
    using Univariate = barretenberg::Univariate<Fr, LENGTH>;
    using Commitment = barretenberg::g1::affine_element;

    std::array<Fr, LENGTH> evaluations;
    for (auto& eval : evaluations) {
        eval = Fr::random_element();
    }

    // Add some junk to the transcript and compute challenges
    uint32_t data = 25;
    auto scalar = Fr::random_element();
    auto commitment = Commitment::one();
    auto univariate = Univariate(evaluations);

    // Instantiate a prover transcript and mock an example protocol
    ProverTranscript<Fr> prover_transcript;

    // round 0
    prover_transcript.send_to_verifier("data", data);
    Fr alpha = prover_transcript.get_challenge("alpha");

    // round 1
    prover_transcript.send_to_verifier("scalar", scalar);
    prover_transcript.send_to_verifier("commitment", commitment);
    Fr beta = prover_transcript.get_challenge("beta");

    // round 2
    prover_transcript.send_to_verifier("univariate", univariate);
    auto [gamma, delta] = prover_transcript.get_challenges("gamma", "delta");

    // Instantiate a verifier transcript from the raw bytes of the prover transcript; receive data and generate
    // challenges according to the example protocol
    VerifierTranscript<Fr> verifier_transcript(prover_transcript.proof_data);

    // round 0
    auto data_received = verifier_transcript.template receive_from_prover<uint32_t>("data");
    Fr verifier_alpha = verifier_transcript.get_challenge("alpha");

    // round 1
    auto scalar_received = verifier_transcript.template receive_from_prover<Fr>("scalar");
    auto commitment_received = verifier_transcript.template receive_from_prover<Commitment>("commitment");
    Fr verifier_beta = verifier_transcript.get_challenge("beta");

    // round 2
    auto univariate_received = verifier_transcript.template receive_from_prover<Univariate>("univariate");
    auto [verifier_gamma, verifier_delta] = verifier_transcript.get_challenges("gamma", "delta");

    // Check the correctness of the elements received by the verifier
    EXPECT_EQ(data_received, data);
    EXPECT_EQ(scalar_received, scalar);
    EXPECT_EQ(commitment_received, commitment);
    EXPECT_EQ(univariate_received, univariate);

    // Check consistency of prover and verifier challenges
    EXPECT_EQ(alpha, verifier_alpha);
    EXPECT_EQ(beta, verifier_beta);
    EXPECT_EQ(gamma, verifier_gamma);
    EXPECT_EQ(delta, verifier_delta);

    // Check consistency of the generated manifests
    EXPECT_EQ(prover_transcript.get_manifest(), verifier_transcript.get_manifest());
}

/**
 * @brief Demonstrate extent to which verifier transcript is flexible / constrained
 *
 */
TYPED_TEST(TranscriptTests, VerifierMistake)
{
    using Fr = barretenberg::fr;

    auto scalar_1 = Fr::random_element();
    auto scalar_2 = Fr::random_element();

    ProverTranscript<Fr> prover_transcript;

    prover_transcript.send_to_verifier("scalar1", scalar_1);
    prover_transcript.send_to_verifier("scalar2", scalar_2);
    auto prover_alpha = prover_transcript.get_challenge("alpha");

    VerifierTranscript<Fr> verifier_transcript(prover_transcript.proof_data);

    verifier_transcript.template receive_from_prover<Fr>("scalar1");
    // accidentally skip receipt of "scalar2"...
    // but then generate a challenge anyway
    auto verifier_alpha = verifier_transcript.get_challenge("alpha");

    // Challenges will not agree but neither will the manifests
    EXPECT_NE(prover_alpha, verifier_alpha);
    EXPECT_NE(prover_transcript.get_manifest(), verifier_transcript.get_manifest());
}

class UltraTranscriptTests : public ::testing::Test {
  public:
    static void SetUpTestSuite() { barretenberg::srs::init_crs_factory("../srs_db/ignition"); }
};

/**
 * @brief Ensure consistency between the manifest generated by the ultra honk prover over the course of proof
 * construction and the one generated by the verifier over the course of proof verification.
 *
 */
TEST_F(UltraTranscriptTests, UltraVerifierManifestConsistency)
{

    // Construct a simple circuit of size n = 8 (i.e. the minimum circuit size)
    auto builder = proof_system::UltraCircuitBuilder();

    auto a = 2;
    builder.add_variable(a);
    builder.add_public_variable(a);

    // Automatically generate a transcript manifest in the prover by constructing a proof
    auto composer = UltraComposer();
    auto instance = composer.create_instance(builder);
    auto prover = composer.create_prover(instance);
    auto proof = prover.construct_proof();

    // Automatically generate a transcript manifest in the verifier by verifying a proof
    auto verifier = composer.create_verifier(instance);
    verifier.verify_proof(proof);

    prover.transcript.print();
    verifier.transcript.print();

    // Check consistency between the manifests generated by the prover and verifier
    auto prover_manifest = prover.transcript.get_manifest();
    auto verifier_manifest = verifier.transcript.get_manifest();

    // Note: a manifest can be printed using manifest.print()
    for (size_t round = 0; round < prover_manifest.size(); ++round) {
        ASSERT_EQ(prover_manifest[round], verifier_manifest[round])
            << "Prover/Verifier manifest discrepency in round " << round;
    }
}

TEST_F(UltraTranscriptTests, FoldingManifestTest)
{
    auto builder_one = proof_system::UltraCircuitBuilder();
    auto a = 2;
    auto b = 3;
    builder_one.add_variable(a);
    builder_one.add_public_variable(a);
    builder_one.add_public_variable(b);

    auto builder_two = proof_system::UltraCircuitBuilder();
    a = 3;
    b = 4;
    builder_two.add_variable(a);
    builder_two.add_variable(b);
    builder_two.add_public_variable(a);
    builder_two.add_public_variable(b);

    auto composer = UltraComposer();
    auto instance_one = composer.create_instance(builder_one);
    auto instance_two = composer.create_instance(builder_two);

    std::vector<std::shared_ptr<ProverInstance>> insts;
    insts.emplace_back(instance_one);
    insts.emplace_back(instance_two);
    auto prover = composer.create_folding_prover(insts);
    auto verifier = composer.create_folding_verifier(insts);

    auto prover_res = prover.fold_instances();
    verifier.fold_public_parameters(prover_res.folding_data);

    prover.transcript.print();
    verifier.transcript.print();

    // Check consistency between the manifests generated by the prover and verifier
    auto prover_manifest = prover.transcript.get_manifest();
    auto verifier_manifest = verifier.transcript.get_manifest();
    for (size_t round = 0; round < prover_manifest.size(); ++round) {
        ASSERT_EQ(prover_manifest[round], verifier_manifest[round])
            << "Prover/Verifier manifest discrepency in round " << round;
    }
}
