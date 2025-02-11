mod public_key_note;

// Account contract that uses Schnorr signatures for authentication.
// The signing key is stored in an immutable private note and should be different from the encryption/nullifying key.
contract SchnorrAccount {
    use dep::std;

    use dep::aztec::{
        context::{PrivateContext, PublicContext, Context},
        entrypoint::{ENTRYPOINT_PAYLOAD_SIZE, EntrypointPayload},
        log::emit_encrypted_log,
        note::{ note_header::NoteHeader, utils as note_utils },
        oracle::{ get_public_key::get_public_key, auth_witness::get_auth_witness },
        state_vars::immutable_singleton::ImmutableSingleton,
        account::AccountActions,
    };

    use crate::public_key_note::{PublicKeyNote, PublicKeyNoteMethods, PUBLIC_KEY_NOTE_LEN};

    struct Storage {
        signing_public_key: ImmutableSingleton<PublicKeyNote, PUBLIC_KEY_NOTE_LEN>,
    }

    impl Storage {
        fn init(context: Context) -> pub Self {
            Storage {
                signing_public_key: ImmutableSingleton::new(context, 1, PublicKeyNoteMethods),
            }
        }
    }

    global ACCOUNT_ACTIONS_STORAGE_SLOT = 2;

    // Constructs the contract
    #[aztec(private)]
    fn constructor(
        signing_pub_key_x: pub Field,
        signing_pub_key_y: pub Field,
    ) {
        let storage = Storage::init(Context::private(&mut context));
        
        let this = context.this_address();
        let mut pub_key_note = PublicKeyNote::new(signing_pub_key_x, signing_pub_key_y, this);
        storage.signing_public_key.initialise(&mut pub_key_note);
        
        emit_encrypted_log(
            &mut context,
            this,
            storage.signing_public_key.storage_slot,
            get_public_key(this),
            pub_key_note.serialise(),
        );
    }

    #[aztec(private)]
    fn entrypoint(payload: pub EntrypointPayload) {
        let actions = AccountActions::private(&mut context, ACCOUNT_ACTIONS_STORAGE_SLOT, is_valid_impl);
        actions.entrypoint(payload);
    }

    #[aztec(private)]
    fn is_valid(message_hash: Field) -> Field {
        let actions = AccountActions::private(&mut context, ACCOUNT_ACTIONS_STORAGE_SLOT, is_valid_impl);
        actions.is_valid(message_hash)
    }

    #[aztec(public)]
    fn is_valid_public(message_hash: Field) -> Field {
        let actions = AccountActions::public(&mut context, ACCOUNT_ACTIONS_STORAGE_SLOT, is_valid_impl);
        actions.is_valid_public(message_hash)
    }

    #[aztec(public)]
    internal fn set_is_valid_storage(message_hash: Field, value: bool) {
        let actions = AccountActions::public(&mut context, ACCOUNT_ACTIONS_STORAGE_SLOT, is_valid_impl);
        actions.internal_set_is_valid_storage(message_hash, value)
    }

    #[contract_library_method]
    fn is_valid_impl(context: &mut PrivateContext, message_hash: Field) -> pub bool {
        // docs:start:entrypoint
        // Load public key from storage
        let storage = Storage::init(Context::private(context));
        let public_key = storage.signing_public_key.get_note();

        // Load auth witness
        let witness: [Field; 64] = get_auth_witness(message_hash);
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 { signature[i] = witness[i] as u8; }

        // Verify signature of the payload bytes
        let verification = std::schnorr::verify_signature(public_key.x, public_key.y, signature, message_hash.to_be_bytes(32));
        assert(verification == true);
        // docs:end:entrypoint
        true
    }

    // Computes notes hash and nullifier.
    // Note 1: Needs to be defined by every contract producing logs.
    // Note 2: Having it in all the contracts gives us the ability to compute the note hash and nullifier differently for different kind of notes.
    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; PUBLIC_KEY_NOTE_LEN]) -> [Field; 4] {
        assert(storage_slot == 1);
        let note_header = NoteHeader { contract_address, nonce, storage_slot };
        note_utils::compute_note_hash_and_nullifier(PublicKeyNoteMethods, note_header, preimage)
    }
}
